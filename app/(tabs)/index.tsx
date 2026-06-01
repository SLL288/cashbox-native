import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, RefreshControl, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  blankDailySummary,
  addLocalDays,
  createProject,
  getActiveProjectId,
  getCurrentUser,
  getDailyCashOverview,
  getDailySummary,
  getExpectedOpeningBalance,
  getOrCreateDailyCash,
  getTodayIso,
  listProjectsForCurrentUser,
  logout,
  saveDailyCash,
  setActiveProjectId,
  subscribeAuth,
} from '@/lib/db';
import { getAutoSyncStatus, notifyAutoSyncComplete, setAutoSyncStatus, subscribeAutoSyncComplete, subscribeAutoSyncStatus, type AutoSyncStatus } from '@/lib/syncSignal';
import { syncWithSupabase } from '@/lib/sync';
import { successFeedback, tapFeedback, warningFeedback } from '@/lib/feedback';
import type { DailyCash, DailyCashOverview, DailySummary, Project, User } from '@/lib/types';

const money = (value: number | null | undefined) =>
  value === null || value === undefined ? '未填写' : value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const parseMoney = (value: string) => {
  const parsed = Number(value.replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
};

export default function TodayScreen() {
  const [user, setUser] = useState<User | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<string | null>(getActiveProjectId());
  const [selectedDate, setSelectedDate] = useState(getTodayIso());
  const [deviceToday, setDeviceToday] = useState(getTodayIso());
  const [daily, setDaily] = useState<DailyCash | null>(null);
  const [expectedOpening, setExpectedOpening] = useState<{ usd: number; lrd: number } | null>(null);
  const [summary, setSummary] = useState<DailySummary>(blankDailySummary());
  const [overview, setOverview] = useState<DailyCashOverview | null>(null);
  const [fundsOpen, setFundsOpen] = useState(false);
  const [actualOpen, setActualOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectLocation, setNewProjectLocation] = useState('');
  const [syncStatus, setSyncStatus] = useState<AutoSyncStatus>(getAutoSyncStatus());
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const [currentUser, allowedProjects] = await Promise.all([getCurrentUser(), listProjectsForCurrentUser()]);
    setUser(currentUser);
    setProjects(allowedProjects);
    const active = getActiveProjectId();
    const selected = allowedProjects.some((project) => project.local_project_id === active) ? active : null;
    setProjectId(selected);
    if (selected) {
      const summaryUserId = currentUser?.role === 'viewer' ? null : currentUser?.local_user_id;
      const [cash, opening, totals, projectOverview] = await Promise.all([
        getOrCreateDailyCash(selected, selectedDate),
        getExpectedOpeningBalance(selected, selectedDate, currentUser?.local_user_id),
        getDailySummary(selected, selectedDate, summaryUserId, true),
        getDailyCashOverview(selected, selectedDate),
      ]);
      setDaily(cash);
      setExpectedOpening(opening);
      setSummary(totals);
      setOverview(projectOverview);
    } else {
      setDaily(null);
      setExpectedOpening(null);
      setSummary(blankDailySummary());
      setOverview(null);
    }
  }, [selectedDate]);

  useFocusEffect(useCallback(() => {
    const today = getTodayIso();
    setDeviceToday(today);
    setSelectedDate(today);
  }, []));
  useFocusEffect(useCallback(() => void load(), [load]));
  useEffect(() => subscribeAuth(load), [load]);
  useEffect(() => subscribeAutoSyncComplete(load), [load]);
  useEffect(() => subscribeAutoSyncStatus(setSyncStatus), []);

  const project = useMemo(() => projects.find((item) => item.local_project_id === projectId), [projects, projectId]);
  const dateOptions = useMemo(() => Array.from({ length: 61 }, (_, index) => addLocalDays(deviceToday, index - 30)), [deviceToday]);
  const expectedUsd = (daily?.initial_usd ?? 0) + summary.cash_in_usd + summary.exchange_in_usd - summary.cash_out_usd - summary.exchange_out_usd;
  const expectedLrd = (daily?.initial_lrd ?? 0) + summary.cash_in_lrd + summary.exchange_in_lrd - summary.cash_out_lrd - summary.exchange_out_lrd;
  const diffUsd = daily?.actual_usd === null || daily?.actual_usd === undefined ? null : daily.actual_usd - expectedUsd;
  const diffLrd = daily?.actual_lrd === null || daily?.actual_lrd === undefined ? null : daily.actual_lrd - expectedLrd;
  const hasSavedDailyCash = Boolean(daily?.local_daily_id);
  const openingOutdated = Boolean(
    hasSavedDailyCash &&
    expectedOpening &&
    daily &&
    (Math.abs(daily.initial_usd - expectedOpening.usd) > 0.0001 || Math.abs(daily.initial_lrd - expectedOpening.lrd) > 0.0001)
  );

  const enterProject = async (nextProjectId: string) => {
    void tapFeedback('进入项目');
    setActiveProjectId(nextProjectId);
    setProjectId(nextProjectId);
    const summaryUserId = user?.role === 'viewer' ? null : user?.local_user_id;
    const [cash, opening, totals] = await Promise.all([
      getOrCreateDailyCash(nextProjectId, selectedDate),
      getExpectedOpeningBalance(nextProjectId, selectedDate, user?.local_user_id),
      getDailySummary(nextProjectId, selectedDate, summaryUserId, true),
    ]);
    setDaily(cash);
    setExpectedOpening(opening);
    setSummary(totals);
    setOverview(await getDailyCashOverview(nextProjectId, selectedDate));
  };

  const createProjectAction = async () => {
    if (!newProjectName.trim()) {
      Alert.alert('项目名称必填');
      return;
    }
    await createProject(newProjectName, newProjectLocation);
    setNewProjectName('');
    setNewProjectLocation('');
    setCreateProjectOpen(false);
    void successFeedback('项目已创建');
    Alert.alert('已创建', '项目已保存到本机。');
    load();
  };

  const refreshSync = async () => {
    void tapFeedback('开始同步');
    setRefreshing(true);
    setAutoSyncStatus('syncing');
    try {
      await syncWithSupabase();
      setAutoSyncStatus('synced');
      notifyAutoSyncComplete();
      await load();
      void successFeedback('同步完成');
    } catch (error) {
      setAutoSyncStatus('error');
      void warningFeedback('同步失败');
      Alert.alert('同步失败', error instanceof Error ? error.message : String(error));
    } finally {
      setRefreshing(false);
    }
  };

  if (!projectId) {
    return (
      <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refreshSync} />}>
        <View style={styles.topRow}>
          <View>
            <Text style={styles.eyebrow}>欢迎，{user?.name}</Text>
            <Text style={styles.title}>选择项目进入</Text>
          </View>
          <Pressable style={styles.iconButton} onPress={() => { void tapFeedback('退出登录'); logout(); router.replace('/login'); }}>
            <Ionicons name="log-out-outline" size={24} color="#111827" />
          </Pressable>
        </View>
        <SyncBadge status={syncStatus} />
        {user?.role === 'admin' ? (
          <Pressable style={styles.createProjectButton} onPress={() => { void tapFeedback('创建项目'); setCreateProjectOpen(true); }}>
            <Ionicons name="add-circle-outline" size={22} color="#111827" />
            <Text style={styles.createProjectText}>创建项目</Text>
          </Pressable>
        ) : null}
        {projects.map((item) => (
          <Pressable key={item.local_project_id} style={styles.projectCard} onPress={() => enterProject(item.local_project_id)}>
            <Text style={styles.projectName}>{item.project_name}</Text>
            <Text style={styles.muted}>{item.location || '未填写地点'}</Text>
          </Pressable>
        ))}
        {projects.length === 0 ? <Text style={styles.empty}>当前用户没有分配项目。</Text> : null}
        <Modal visible={createProjectOpen} animationType="slide" presentationStyle="pageSheet">
          <KeyboardAvoidingView style={styles.modal} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={24}>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.modalContent}>
              <Text style={styles.modalTitle}>创建项目</Text>
              <Field label="项目名称" value={newProjectName} onChangeText={setNewProjectName} />
              <Field label="地点" value={newProjectLocation} onChangeText={setNewProjectLocation} />
              <View style={styles.modalActions}>
                <Pressable style={styles.secondaryButton} onPress={() => { void tapFeedback('取消'); setCreateProjectOpen(false); }}><Text style={styles.secondaryButtonText}>取消</Text></Pressable>
                <Pressable style={styles.primaryButton} onPress={() => { void tapFeedback('保存'); void createProjectAction(); }}><Text style={styles.primaryButtonText}>保存</Text></Pressable>
              </View>
            </ScrollView>
          </KeyboardAvoidingView>
        </Modal>
      </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
    <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refreshSync} />}>
      <View style={styles.topRow}>
        <View>
          <Text style={styles.eyebrow}>{user?.name} - {user?.role === 'admin' ? '管理员' : user?.role === 'viewer' ? '查看员' : '经理'}</Text>
          <Text style={styles.title}>今日现金箱</Text>
        </View>
        <View style={styles.iconActions}>
          <Pressable style={styles.iconButton} onPress={() => { void tapFeedback('返回项目选择'); setActiveProjectId(null); }}>
            <Ionicons name="swap-horizontal-outline" size={24} color="#111827" />
          </Pressable>
          <Pressable style={styles.iconButton} onPress={() => { void tapFeedback('使用说明'); setInfoOpen(true); }}>
            <Ionicons name="information-circle-outline" size={24} color="#111827" />
          </Pressable>
          <Pressable style={styles.iconButton} onPress={() => { void tapFeedback('退出登录'); logout(); router.replace('/login'); }}>
            <Ionicons name="log-out-outline" size={24} color="#111827" />
          </Pressable>
        </View>
      </View>
      <SyncBadge status={syncStatus} />

      <Text style={styles.projectLabel}>{project?.project_name}</Text>
      <DateSelect
        value={selectedDate}
        dates={dateOptions}
        visible={dateOpen}
        onOpen={() => setDateOpen(true)}
        onClose={() => setDateOpen(false)}
        onChange={setSelectedDate}
      />

      {daily ? (
        <>
          {user?.role === 'viewer' ? null : <View style={styles.statusCard}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>我的现金箱</Text>
              <Pressable style={styles.smallButton} onPress={() => { void tapFeedback('录入实点'); setActualOpen(true); }}>
                <Text style={styles.smallButtonText}>录入实点</Text>
              </Pressable>
            </View>
            <MoneyRow label="应有" usd={`$${money(expectedUsd)}`} lrd={`L$ ${money(expectedLrd)}`} />
            <MoneyRow label="实点" usd={daily.actual_usd === null ? '未录入' : `$${money(daily.actual_usd)}`} lrd={daily.actual_lrd === null ? '未录入' : `L$ ${money(daily.actual_lrd)}`} muted={daily.actual_usd === null && daily.actual_lrd === null} />
            <MoneyRow label="差额" usd={diffUsd === null ? '未录入' : `$${money(diffUsd)}`} lrd={diffLrd === null ? '未录入' : `L$ ${money(diffLrd)}`} tone={(diffUsd ?? 0) < 0 || (diffLrd ?? 0) < 0 ? 'bad' : 'good'} />
          </View>}
          {openingOutdated ? (
            <View style={styles.warningBanner}>
              <Ionicons name="warning-outline" size={18} color="#92400E" />
              <Text style={styles.warningText}>Opening balance may be outdated because previous records changed.</Text>
            </View>
          ) : null}

          {overview ? (
            <View style={styles.panel}>
              <Text style={styles.sectionTitle}>项目汇总</Text>
              <MoneyRow label="总初始" usd={`$${money(overview.initial_usd)}`} lrd={`L$ ${money(overview.initial_lrd)}`} />
              <MoneyRow label="总应有" usd={`$${money(overview.expected_usd)}`} lrd={`L$ ${money(overview.expected_lrd)}`} />
              <MoneyRow label="总余额" usd={`$${money(overview.balance_usd)}`} lrd={`L$ ${money(overview.balance_lrd)}`} />
              <Text style={styles.overviewHint}>{overview.actual_count > 0 ? '已优先使用已录入实点；未录入人员使用应有余额。' : '暂无实点，当前总余额使用应有余额计算。'}</Text>
              {overview.users.map((item) => (
                <View key={item.local_user_id} style={styles.personRow}>
                  <Text style={styles.personName}>{item.name}</Text>
                  <Text style={styles.personValue}>USD {money(item.balance_usd)} / LRD {money(item.balance_lrd)}</Text>
                </View>
              ))}
            </View>
          ) : null}

          <View style={styles.panel}>
            <Text style={styles.sectionTitle}>今日流水</Text>
            <ActionRow label="现金收入" detail={`USD ${money(summary.cash_in_usd)} / LRD ${money(summary.cash_in_lrd)}`} tone="good" onPress={user?.role === 'viewer' ? undefined : () => router.push(`/add?type=cash_in&date=${selectedDate}`)} />
            <ActionRow label="支出" detail={`USD ${money(summary.cash_out_usd)} / LRD ${money(summary.cash_out_lrd)}`} tone="bad" onPress={user?.role === 'viewer' ? undefined : () => router.push(`/add?type=expense&date=${selectedDate}`)} />
            <ActionRow label="货币兑换" detail={`入 USD ${money(summary.exchange_in_usd)} / 入 LRD ${money(summary.exchange_in_lrd)}`} onPress={user?.role === 'viewer' ? undefined : () => router.push(`/add?type=exchange&date=${selectedDate}`)} />
            {user?.role === 'viewer' ? null : <ActionRow label="经理转账" detail="转给另一位经理" onPress={() => router.push(`/add?type=transfer&date=${selectedDate}`)} />}
          </View>

          <Pressable style={styles.panel} disabled={user?.role === 'viewer'} onPress={() => { void tapFeedback('编辑初始资金'); setFundsOpen(true); }}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>初始资金</Text>
              <Text style={styles.tapHint}>点击编辑</Text>
            </View>
            <MoneyRow label="初始" usd={`$${money(daily.initial_usd)}`} lrd={`L$ ${money(daily.initial_lrd)}`} />
            {!hasSavedDailyCash ? <Text style={styles.previewHint}>预览初始余额，保存后才会建立现金日。</Text> : null}
          </Pressable>

          <Pressable style={styles.detailButton} onPress={() => { void tapFeedback('查看明细'); router.push(`/history?date=${selectedDate}`); }}>
            <Ionicons name="list-outline" size={22} color="#111827" />
            <Text style={styles.detailText}>查看当天支出和收入明细</Text>
          </Pressable>

          <CashModal visible={fundsOpen} title="编辑初始资金" projectId={projectId} daily={daily} fields="initial" onClose={() => setFundsOpen(false)} onSaved={load} />
          <CashModal visible={actualOpen} title="编辑实点现金" projectId={projectId} daily={daily} fields="actual" onClose={() => setActualOpen(false)} onSaved={load} />
          <InfoModal visible={infoOpen} onClose={() => setInfoOpen(false)} />
        </>
      ) : null}
    </ScrollView>
    </SafeAreaView>
  );
}

function InfoModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  return (
    <Modal visible={visible} animationType="fade" transparent>
      <Pressable style={styles.infoBackdrop} onPress={() => { void tapFeedback('关闭说明'); onClose(); }}>
        <Pressable style={styles.infoCard} onPress={() => undefined}>
          <View style={styles.infoHeader}>
            <Ionicons name="information-circle-outline" size={24} color="#7C5C16" />
            <Text style={styles.infoTitle}>使用说明</Text>
          </View>
          <Text style={styles.infoText}>初始资金：每天开始时填写开账现金；默认带入上一单余额。</Text>
          <Text style={styles.infoText}>实点现金：每天结束时填写实际现金余额，用来校准现金差额。</Text>
          <Pressable style={styles.infoCloseButton} onPress={() => { void tapFeedback('知道了'); onClose(); }}>
            <Text style={styles.infoCloseText}>知道了</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function MoneyRow({ label, usd, lrd, tone, muted }: { label: string; usd: string; lrd: string; tone?: 'good' | 'bad'; muted?: boolean }) {
  return (
    <View style={styles.moneyRow}>
      <Text style={styles.moneyLabel}>{label}</Text>
      <View style={styles.moneyValues}>
        <Text style={[styles.moneyValue, muted && styles.mutedValue, tone === 'good' && styles.good, tone === 'bad' && styles.bad]}>{usd}</Text>
        <Text style={[styles.moneyValue, muted && styles.mutedValue, tone === 'good' && styles.good, tone === 'bad' && styles.bad]}>{lrd}</Text>
      </View>
    </View>
  );
}

function ActionRow({ label, detail, tone, onPress }: { label: string; detail: string; tone?: 'good' | 'bad'; onPress?: () => void }) {
  return (
    <Pressable style={styles.actionRow} disabled={!onPress} onPress={() => { void tapFeedback(label); onPress?.(); }}>
      <View>
        <Text style={styles.actionLabel}>{label}</Text>
        <Text style={[styles.actionDetail, tone === 'good' && styles.good, tone === 'bad' && styles.bad]}>{detail}</Text>
      </View>
      <Text style={styles.actionHint}>新增</Text>
    </Pressable>
  );
}

function SyncBadge({ status }: { status: AutoSyncStatus }) {
  const text = status === 'synced' ? '已同步' : status === 'syncing' ? '同步中' : status === 'offline' ? '离线' : status === 'error' ? '待重试' : '待同步';
  const tone = status === 'synced' ? styles.syncGood : status === 'offline' || status === 'error' ? styles.syncBad : styles.syncPending;
  return (
    <View style={[styles.syncBadge, tone]}>
      <Ionicons name={status === 'synced' ? 'cloud-done-outline' : status === 'offline' ? 'cloud-offline-outline' : 'cloud-upload-outline'} size={16} color="#111827" />
      <Text style={styles.syncText}>{text} · 自动</Text>
    </View>
  );
}

function DateSelect({
  value,
  dates,
  visible,
  onOpen,
  onClose,
  onChange,
}: {
  value: string;
  dates: string[];
  visible: boolean;
  onOpen: () => void;
  onClose: () => void;
  onChange: (value: string) => void;
}) {
  const today = getTodayIso();
  const scrollRef = React.useRef<ScrollView>(null);
  const selectedIndex = Math.max(0, dates.indexOf(value.slice(0, 10)));
  const centerSelected = () => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ y: Math.max(0, selectedIndex * 48 - 168), animated: false });
    });
  };
  return (
    <View style={styles.dateBlock}>
      <Text style={styles.label}>日期</Text>
      <Pressable
        style={styles.dateButton}
        onPress={() => {
          void tapFeedback('选择日期');
          onOpen();
          centerSelected();
        }}>
        <Text style={[styles.dateButtonText, value === today && styles.todayText]}>
          {value === today ? `${value} 今天` : value}
        </Text>
      </Pressable>
      <Modal visible={visible} animationType="slide" transparent>
        <Pressable style={styles.sheetBackdrop} onPress={() => { void tapFeedback('关闭日期'); onClose(); }}>
          <View style={styles.dateSheet}>
            <Text style={styles.sheetTitle}>选择日期</Text>
            <ScrollView ref={scrollRef} style={styles.dateList} onContentSizeChange={centerSelected}>
              {dates.map((item) => (
                <Pressable
                  key={item}
                  style={[styles.dateOption, value === item && styles.dateOptionActive]}
                  onPress={() => {
                    void tapFeedback(item);
                    onChange(item);
                    onClose();
                  }}>
                  <Text style={[styles.dateOptionText, item === today && styles.todayText, value === item && styles.dateOptionTextActive]}>
                    {item}{item === today ? '  今天' : ''}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
            <Pressable style={styles.secondaryButton} onPress={() => { void tapFeedback('取消'); onClose(); }}>
              <Text style={styles.secondaryButtonText}>取消</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

function CashModal({
  visible,
  title,
  projectId,
  daily,
  fields,
  onClose,
  onSaved,
}: {
  visible: boolean;
  title: string;
  projectId: string;
  daily: DailyCash;
  fields: 'initial' | 'actual';
  onClose: () => void;
  onSaved: () => void;
}) {
  const [usd, setUsd] = useState('');
  const [lrd, setLrd] = useState('');
  const [note, setNote] = useState('');
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (visible) {
      setUsd(String(fields === 'initial' ? daily.initial_usd : daily.actual_usd ?? ''));
      setLrd(String(fields === 'initial' ? daily.initial_lrd : daily.actual_lrd ?? ''));
      setNote(daily.note ?? '');
    }
  }, [daily, fields, visible]);

  const save = async () => {
    const values: { initial_usd?: number; initial_lrd?: number; actual_usd?: number | null; actual_lrd?: number | null; note?: string | null } = {
      ...(fields === 'initial'
        ? { initial_usd: parseMoney(usd), initial_lrd: parseMoney(lrd) }
        : { actual_usd: usd.trim() ? parseMoney(usd) : null, actual_lrd: lrd.trim() ? parseMoney(lrd) : null }),
      note: note.trim() || null,
    };
    if (fields === 'actual' && !daily.local_daily_id && values.actual_usd === null && values.actual_lrd === null) {
      onClose();
      return;
    }
    await saveDailyCash(projectId, daily.date, values);
    onClose();
    void successFeedback('保存成功');
    Alert.alert('已保存', '数据已保存到本机。');
    onSaved();
  };

  const clearActual = async () => {
    if (!daily.local_daily_id) {
      setUsd('');
      setLrd('');
      onClose();
      return;
    }
    await saveDailyCash(projectId, daily.date, {
      actual_usd: null,
      actual_lrd: null,
      note: note.trim() || null,
    });
    setUsd('');
    setLrd('');
    onClose();
    void successFeedback('已设为未录入');
    Alert.alert('已清空', '实点金额已改为未录入。');
    onSaved();
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <KeyboardAvoidingView style={styles.modal} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={24}>
      <ScrollView ref={scrollRef} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" contentContainerStyle={styles.modalContent}>
        <Text style={styles.modalTitle}>{title}</Text>
        <Field label="USD" value={usd} onChangeText={setUsd} keyboardType="decimal-pad" />
        <Field label="LRD" value={lrd} onChangeText={setLrd} keyboardType="decimal-pad" />
        <Field label="备注 / 原因" value={note} onChangeText={setNote} multiline onFocus={() => setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 120)} />
        {fields === 'actual' ? (
          <Pressable style={styles.clearButton} onPress={() => { void tapFeedback('设为未录入'); void clearActual(); }}>
            <Text style={styles.clearButtonText}>设为未统计 / 未录入</Text>
          </Pressable>
        ) : null}
        <View style={styles.modalActions}>
          <Pressable style={styles.secondaryButton} onPress={() => { void tapFeedback('取消'); onClose(); }}><Text style={styles.secondaryButtonText}>取消</Text></Pressable>
          <Pressable style={styles.primaryButton} onPress={() => { void tapFeedback('保存'); void save(); }}><Text style={styles.primaryButtonText}>保存</Text></Pressable>
        </View>
      </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function Field(props: React.ComponentProps<typeof TextInput> & { label: string }) {
  const { label, ...inputProps } = props;
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput {...inputProps} placeholderTextColor="#8A6F3D" style={[styles.input, inputProps.multiline && styles.textArea]} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F6F1E8' },
  content: { padding: 18, paddingTop: 14, paddingBottom: 38 },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  iconActions: { flexDirection: 'row', gap: 8 },
  iconButton: { width: 46, height: 46, borderRadius: 8, backgroundColor: '#FFF9EA', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#C8A94B' },
  eyebrow: { color: '#7C5C16', fontSize: 13, fontWeight: '900' },
  title: { color: '#111827', fontSize: 30, fontWeight: '900', marginTop: 4 },
  projectLabel: { color: '#374151', fontSize: 17, fontWeight: '900', marginTop: 14, marginBottom: 10 },
  createProjectButton: { minHeight: 54, borderRadius: 8, backgroundColor: '#F3C74D', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 18 },
  syncBadge: { alignSelf: 'flex-start', minHeight: 32, borderRadius: 8, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, marginTop: 12, borderWidth: 1 },
  syncText: { color: '#111827', fontSize: 12, fontWeight: '900' },
  syncGood: { backgroundColor: '#D1FAE5', borderColor: '#6EE7B7' },
  syncPending: { backgroundColor: '#FEF3C7', borderColor: '#F3C74D' },
  syncBad: { backgroundColor: '#FEE2E2', borderColor: '#FCA5A5' },
  createProjectText: { color: '#111827', fontSize: 16, fontWeight: '900' },
  projectCard: { backgroundColor: '#FFFFFF', borderRadius: 8, padding: 16, borderWidth: 1, borderColor: '#E5D9BF', marginTop: 12 },
  projectName: { color: '#111827', fontSize: 19, fontWeight: '900' },
  muted: { color: '#6B7280', marginTop: 6 },
  dateBlock: { marginBottom: 16 },
  dateButton: { minHeight: 48, borderRadius: 8, borderWidth: 1, borderColor: '#D1D5DB', backgroundColor: '#FFFFFF', paddingHorizontal: 12, justifyContent: 'center' },
  dateButtonText: { color: '#111827', fontSize: 17, fontWeight: '900' },
  todayText: { color: '#B45309' },
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(17, 24, 39, 0.35)', justifyContent: 'flex-end' },
  dateSheet: { maxHeight: '72%', backgroundColor: '#F6F1E8', borderTopLeftRadius: 8, borderTopRightRadius: 8, padding: 16 },
  sheetTitle: { color: '#111827', fontSize: 20, fontWeight: '900', marginBottom: 10 },
  dateList: { maxHeight: 420 },
  dateOption: { minHeight: 48, borderBottomWidth: 1, borderBottomColor: '#E5D9BF', justifyContent: 'center', paddingHorizontal: 8 },
  dateOptionActive: { backgroundColor: '#111827', borderRadius: 8, borderBottomWidth: 0 },
  dateOptionText: { color: '#374151', fontSize: 17, fontWeight: '900', textAlign: 'center' },
  dateOptionTextActive: { color: '#FFFFFF' },
  statusCard: { backgroundColor: '#FFFFFF', borderRadius: 8, padding: 14, gap: 8, marginBottom: 12, borderWidth: 1.5, borderColor: '#C8A94B' },
  panel: { backgroundColor: '#FFFFFF', borderRadius: 8, padding: 14, borderWidth: 1, borderColor: '#E5D9BF', marginBottom: 12 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  sectionTitle: { color: '#111827', fontSize: 17, fontWeight: '900' },
  moneyRow: { borderTopWidth: 1, borderTopColor: 'rgba(209, 213, 219, 0.35)', paddingTop: 10, marginTop: 8 },
  moneyLabel: { color: '#8A6F3D', fontSize: 12, fontWeight: '900' },
  moneyValues: { flexDirection: 'row', justifyContent: 'space-between', gap: 10, marginTop: 5 },
  moneyValue: { color: '#111827', fontSize: 18, fontWeight: '900' },
  mutedValue: { color: '#6B7280' },
  actionRow: { minHeight: 58, borderTopWidth: 1, borderTopColor: '#E5E7EB', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingTop: 10, marginTop: 10 },
  actionLabel: { color: '#111827', fontSize: 15, fontWeight: '900' },
  actionDetail: { color: '#4B5563', fontSize: 13, marginTop: 4, fontWeight: '700' },
  actionHint: { color: '#7C5C16', fontSize: 13, fontWeight: '900' },
  overviewHint: { color: '#6B7280', fontSize: 12, marginTop: 8 },
  previewHint: { color: '#6B7280', fontSize: 12, marginTop: 8, fontWeight: '700' },
  warningBanner: { minHeight: 48, borderRadius: 8, borderWidth: 1, borderColor: '#F59E0B', backgroundColor: '#FEF3C7', flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, marginBottom: 12 },
  warningText: { color: '#92400E', fontSize: 13, fontWeight: '800', flex: 1 },
  personRow: { borderTopWidth: 1, borderTopColor: '#E5E7EB', paddingTop: 9, marginTop: 9 },
  personName: { color: '#111827', fontSize: 14, fontWeight: '900' },
  personValue: { color: '#4B5563', fontSize: 13, marginTop: 3, fontWeight: '700' },
  smallButton: { backgroundColor: '#F3C74D', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  smallButtonText: { color: '#111827', fontWeight: '900' },
  tapHint: { color: '#7C5C16', fontSize: 11, fontWeight: '900', marginTop: 8 },
  good: { color: '#047857' },
  bad: { color: '#B91C1C' },
  detailButton: { minHeight: 56, borderRadius: 8, backgroundColor: '#F3C74D', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 18 },
  detailText: { color: '#111827', fontSize: 16, fontWeight: '900' },
  empty: { color: '#6B7280', textAlign: 'center', marginTop: 32 },
  modal: { flex: 1, backgroundColor: '#F6F1E8' },
  modalContent: { padding: 18, paddingTop: 60, paddingBottom: 140 },
  modalTitle: { color: '#111827', fontSize: 26, fontWeight: '900', marginBottom: 18 },
  field: { marginBottom: 14 },
  label: { color: '#374151', fontSize: 13, fontWeight: '900', marginBottom: 7 },
  input: { minHeight: 50, borderRadius: 8, borderWidth: 1.5, borderColor: '#C8A94B', backgroundColor: '#FFFCF5', paddingHorizontal: 12, color: '#111827', fontSize: 17 },
  textArea: { minHeight: 92, paddingTop: 12, textAlignVertical: 'top' },
  clearButton: { minHeight: 48, borderRadius: 8, backgroundColor: '#FEE2E2', alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  clearButtonText: { color: '#991B1B', fontSize: 15, fontWeight: '900' },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 10 },
  primaryButton: { flex: 1, minHeight: 52, borderRadius: 8, backgroundColor: '#111827', alignItems: 'center', justifyContent: 'center' },
  primaryButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '900' },
  secondaryButton: { flex: 1, minHeight: 52, borderRadius: 8, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#D1D5DB', alignItems: 'center', justifyContent: 'center' },
  secondaryButtonText: { color: '#111827', fontSize: 16, fontWeight: '900' },
  infoBackdrop: { flex: 1, backgroundColor: 'rgba(17, 24, 39, 0.38)', alignItems: 'center', justifyContent: 'center', padding: 18 },
  infoCard: { width: '100%', maxWidth: 360, borderRadius: 8, backgroundColor: '#FFFCF5', borderWidth: 1, borderColor: '#C8A94B', padding: 18 },
  infoHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  infoTitle: { color: '#111827', fontSize: 20, fontWeight: '900' },
  infoText: { color: '#374151', fontSize: 16, lineHeight: 24, fontWeight: '700', marginTop: 8 },
  infoCloseButton: { minHeight: 48, borderRadius: 8, backgroundColor: '#111827', alignItems: 'center', justifyContent: 'center', marginTop: 18 },
  infoCloseText: { color: '#FFFFFF', fontSize: 16, fontWeight: '900' },
});

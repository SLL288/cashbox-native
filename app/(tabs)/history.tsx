import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Alert, Image, KeyboardAvoidingView, Modal, Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Swipeable from 'react-native-gesture-handler/ReanimatedSwipeable';

import {
  AREA_OPTIONS,
  CASH_IN_CATEGORIES,
  EXPENSE_CATEGORIES,
  addLocalDays,
  blankDailySummary,
  deleteTransaction,
  getActiveProjectId,
  getCurrentUser,
  getDailyCashOverview,
  getDailySummary,
  getOrCreateDailyCash,
  getTodayIso,
  listProjectsForCurrentUser,
  listTransactions,
  listUsers,
  replaceLocalDate,
  updateTransaction,
} from '@/lib/db';
import { successFeedback, tapFeedback } from '@/lib/feedback';
import { supabase } from '@/lib/supabase';
import { subscribeAutoSyncComplete } from '@/lib/syncSignal';
import type { Area, CashTransaction, Currency, DailyCash, DailyCashOverview, DailySummary, Project, User } from '@/lib/types';

const money = (value: number) => value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function paymentParts(item: CashTransaction) {
  const hasComponents = item.type !== 'exchange' && (item.from_currency === 'USD' || item.to_currency === 'LRD');
  if (hasComponents) {
    return {
      usd: item.from_currency === 'USD' ? Number(item.from_amount) || 0 : 0,
      lrd: item.to_currency === 'LRD' ? Number(item.to_amount) || 0 : 0,
    };
  }
  return {
    usd: item.currency === 'USD' ? Number(item.amount) || 0 : 0,
    lrd: item.currency === 'LRD' ? Number(item.amount) || 0 : 0,
  };
}

function formatPaymentParts(item: CashTransaction) {
  const parts = paymentParts(item);
  return [
    parts.usd > 0 ? `USD ${money(parts.usd)}` : null,
    parts.lrd > 0 ? `LRD ${money(parts.lrd)}` : null,
  ].filter(Boolean).join(' / ') || `${item.currency} ${money(item.amount)}`;
}

export default function HistoryScreen() {
  const params = useLocalSearchParams<{ date?: string }>();
  const [deviceToday, setDeviceToday] = useState(getTodayIso());
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState(getActiveProjectId() ?? '');
  const [date, setDate] = useState(params.date ?? getTodayIso());
  const [search, setSearch] = useState('');
  const [transactions, setTransactions] = useState<CashTransaction[]>([]);
  const [daily, setDaily] = useState<DailyCash | null>(null);
  const [overview, setOverview] = useState<DailyCashOverview | null>(null);
  const [summary, setSummary] = useState<DailySummary>(blankDailySummary());
  const [editing, setEditing] = useState<CashTransaction | null>(null);
  const [dateOpen, setDateOpen] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [userFilterId, setUserFilterId] = useState<string | null>(null);
  const [viewingPhoto, setViewingPhoto] = useState<{ uri: string; title: string } | null>(null);
  const defaultedUserFilterRef = useRef(false);

  const load = useCallback(async () => {
    const [rows, activeUser, allUsers] = await Promise.all([listProjectsForCurrentUser(), getCurrentUser(), listUsers()]);
    setProjects(rows);
    setCurrentUser(activeUser);
    setUsers(allUsers);
    const active = getActiveProjectId();
    const selected = rows.some((project) => project.local_project_id === projectId)
      ? projectId
      : rows.some((project) => project.local_project_id === active)
        ? active ?? ''
        : rows[0]?.local_project_id ?? '';
    setProjectId(selected);
    const shouldDefaultToManager = !defaultedUserFilterRef.current && userFilterId === null && activeUser?.role === 'manager';
    const effectiveUserFilterId = shouldDefaultToManager ? activeUser.local_user_id : userFilterId;
    if (shouldDefaultToManager) {
      defaultedUserFilterRef.current = true;
      setUserFilterId(activeUser.local_user_id);
    }
    if (selected) {
      const [items, cash, totals] = await Promise.all([
        listTransactions(selected, date, search, effectiveUserFilterId, true),
        getOrCreateDailyCash(selected, date),
        getDailySummary(selected, date, effectiveUserFilterId, true),
      ]);
      const projectOverview = await getDailyCashOverview(selected, date, effectiveUserFilterId);
      setTransactions(items);
      setDaily(cash);
      setSummary(totals);
      setOverview(projectOverview);
    }
  }, [date, projectId, search, userFilterId]);

  useFocusEffect(useCallback(() => {
    const today = getTodayIso();
    setDeviceToday(today);
    if (!params.date) setDate(today);
  }, [params.date]));
  useFocusEffect(useCallback(() => void load(), [load]));
  React.useEffect(() => subscribeAutoSyncComplete(load), [load]);

  const expectedUsd = overview?.expected_usd ?? 0;
  const expectedLrd = overview?.expected_lrd ?? 0;
  const hasExchange = transactions.some((item) => item.type === 'exchange');
  const selectedUser = useMemo(() => users.find((item) => item.local_user_id === userFilterId), [userFilterId, users]);
  const filterUsers = useMemo(() => {
    if (!currentUser) return users;
    return [...users].sort((a, b) => {
      if (a.local_user_id === currentUser.local_user_id) return -1;
      if (b.local_user_id === currentUser.local_user_id) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [currentUser, users]);
  const selectedUserOverview = useMemo(() => overview?.users.find((item) => item.local_user_id === userFilterId), [overview, userFilterId]);
  const actualUsdText = userFilterId
    ? (selectedUserOverview?.actual_usd === null || selectedUserOverview?.actual_usd === undefined ? '未录入' : money(selectedUserOverview.actual_usd))
    : overview
      ? overview.actual_count === 0 ? `按应有 ${money(overview.expected_usd)}` : money(overview.balance_usd)
      : '未录入';
  const actualLrdText = userFilterId
    ? (selectedUserOverview?.actual_lrd === null || selectedUserOverview?.actual_lrd === undefined ? '未录入' : money(selectedUserOverview.actual_lrd))
    : overview
      ? overview.actual_count === 0 ? `按应有 ${money(overview.expected_lrd)}` : money(overview.balance_lrd)
      : '未录入';
  const canManageTransaction = (item: CashTransaction) => currentUser?.role === 'admin' || (currentUser?.role === 'manager' && item.created_by === currentUser?.local_user_id);

  const viewPhoto = async (item: CashTransaction) => {
    void tapFeedback('查看照片');
    const uri = await resolvePhotoUri(item.photo_uri);
    if (!uri) {
      Alert.alert('无法打开照片', '照片还没有同步完成，或远程图片链接已失效。');
      return;
    }
    setViewingPhoto({ uri, title: item.transaction_no });
  };

  const askDelete = (item: CashTransaction) => {
    void tapFeedback('删除');
    if (!canManageTransaction(item)) {
      Alert.alert('只读记录', '经理只能修改或删除自己录入的记录。');
      return;
    }
    Alert.alert('删除记录', `确定删除 ${item.transaction_no} 吗？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          void tapFeedback('确认删除');
          await deleteTransaction(item);
          void successFeedback('已删除');
          Alert.alert('已删除', '记录已在本机停用，并写入审计日志。');
          load();
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.screen}>
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.title}>历史记录</Text>

      <Text style={styles.label}>项目</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {projects.map((project) => (
          <Choice key={project.local_project_id} label={project.project_name} active={project.local_project_id === projectId} onPress={() => setProjectId(project.local_project_id)} />
        ))}
      </ScrollView>

      <DateSelect label="日期" today={deviceToday} value={date} visible={dateOpen} onOpen={() => setDateOpen(true)} onClose={() => setDateOpen(false)} onChange={setDate} />
      <Field label="搜索" value={search} onChangeText={setSearch} placeholder="单号、备注、类别、地点" />
      <Text style={styles.label}>查看范围</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        <Choice label="项目全部" active={!userFilterId} onPress={() => setUserFilterId(null)} />
        {filterUsers.map((user) => (
          <Choice key={user.local_user_id} label={`${user.name} (${user.role === 'admin' ? '管理员' : user.role === 'viewer' ? '查看员' : '经理'})`} active={userFilterId === user.local_user_id} onPress={() => setUserFilterId(user.local_user_id)} />
        ))}
      </ScrollView>

      <CopySummaryBlock
        date={date}
        daily={daily}
        overview={overview}
        summary={summary}
        expectedUsd={expectedUsd}
        expectedLrd={expectedLrd}
        title={selectedUser ? `当日汇总 - ${selectedUser.name}` : '项目汇总'}
        actualUsdText={actualUsdText}
        actualLrdText={actualLrdText}
        includePeople={!userFilterId}
        transactions={transactions}>
        <Text style={styles.summaryTitle}>{selectedUser ? `当日汇总 - ${selectedUser.name}（双击复制）` : '项目汇总（双击复制）'}</Text>
        <Text style={styles.summaryLine}>初始：USD {money(overview?.initial_usd ?? 0)} / LRD {money(overview?.initial_lrd ?? 0)}</Text>
        <Text style={styles.summaryLine}>收入：USD {money(summary.cash_in_usd)} / LRD {money(summary.cash_in_lrd)}</Text>
        <Text style={styles.summaryLine}>支出：USD {money(summary.cash_out_usd)} / LRD {money(summary.cash_out_lrd)}</Text>
        {hasExchange ? <Text style={styles.summaryLine}>兑换入：USD {money(summary.exchange_in_usd)} / LRD {money(summary.exchange_in_lrd)}</Text> : null}
        {hasExchange ? <Text style={styles.summaryLine}>兑换出：USD {money(summary.exchange_out_usd)} / LRD {money(summary.exchange_out_lrd)}</Text> : null}
        <Text style={styles.summaryStrong}>应有：USD {money(expectedUsd)} / LRD {money(expectedLrd)}</Text>
        <Text style={styles.summaryStrong}>实际剩余：USD {actualUsdText} / LRD {actualLrdText}</Text>
        {!userFilterId && overview?.users.map((item) => (
          <View key={item.local_user_id} style={styles.personSummary}>
            <Text style={styles.personSummaryName}>{item.name}</Text>
            <Text style={styles.personSummaryText}>余额 USD {money(item.balance_usd)} / LRD {money(item.balance_lrd)}</Text>
          </View>
        ))}
        <Text style={styles.summarySubTitle}>明细</Text>
        {transactions.map((item) => (
          <SwipeSummaryRow
            key={`summary-${item.local_transaction_id}`}
            item={item}
            canEdit={canManageTransaction(item)}
            onEdit={() => {
              if (canManageTransaction(item)) setEditing(item);
              else Alert.alert('只读记录', '经理只能修改自己录入的记录。');
            }}
            onViewPhoto={() => viewPhoto(item)}
            onDelete={() => askDelete(item)}
          />
        ))}
        {transactions.length === 0 ? <Text style={styles.summaryLine}>当天没有记录。</Text> : null}
      </CopySummaryBlock>

      {transactions.length === 0 ? <Text style={styles.empty}>没有符合条件的记录。</Text> : null}
      {editing ? <EditModal transaction={editing} onClose={() => setEditing(null)} onSaved={load} /> : null}
      {viewingPhoto ? <PhotoViewer title={viewingPhoto.title} uri={viewingPhoto.uri} onClose={() => setViewingPhoto(null)} /> : null}
    </ScrollView>
    </SafeAreaView>
  );
}

function labelType(type: string) {
  if (type === 'expense') return '支出';
  if (type === 'cash_in') return '收入';
  if (type === 'transfer') return '转账';
  return '兑换';
}

function formatTransactionAmount(item: CashTransaction) {
  if (item.type === 'exchange') {
    return `${item.from_currency} ${money(item.from_amount ?? 0)} -> ${item.to_currency} ${money(item.to_amount ?? 0)}`;
  }
  return formatPaymentParts(item);
}

function transactionTitleAmount(item: CashTransaction) {
  if (item.type === 'expense') return `-${formatPaymentParts(item)}`;
  if (item.type === 'cash_in') return `+${formatPaymentParts(item)}`;
  if (item.type === 'transfer') return `-${formatPaymentParts(item)}`;
  return `兑换 ${formatTransactionAmount(item)}`;
}

function transactionAmountStyle(item: CashTransaction) {
  if (item.type === 'expense') return styles.expenseAmount;
  if (item.type === 'cash_in') return styles.cashInAmount;
  if (item.type === 'transfer') return styles.expenseAmount;
  return styles.exchangeAmount;
}

function transactionDescription(item: CashTransaction) {
  const area = item.area ? `${item.area} - ` : '';
  const note = item.note ? ` / ${item.note}` : '';
  const change = item.type === 'expense' && ((item.change_usd ?? 0) > 0 || (item.change_lrd ?? 0) > 0)
    ? ` / 找零 USD ${money(item.change_usd ?? 0)} LRD ${money(item.change_lrd ?? 0)}`
    : '';
  const photo = item.photo_uri ? ' / 有照片' : '';
  return `${area}${item.category}${change}${photo}${note}`;
}

function recordDateTime(item: CashTransaction) {
  return new Date(item.created_at_local || item.date).toLocaleString([], { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

async function resolvePhotoUri(uri: string | null) {
  if (!uri) return null;
  if (uri.startsWith('http://') || uri.startsWith('https://') || uri.startsWith('file://')) return uri;
  if (!uri.startsWith('storage://') || !supabase) return null;
  const path = uri.replace('storage://', '');
  const { data, error } = await supabase.storage.from('transaction-photos').createSignedUrl(path, 60 * 60);
  if (error) return null;
  return data.signedUrl;
}

function DateSelect({
  label,
  today,
  value,
  visible,
  onOpen,
  onClose,
  onChange,
}: {
  label: string;
  today: string;
  value: string;
  visible: boolean;
  onOpen: () => void;
  onClose: () => void;
  onChange: (value: string) => void;
}) {
  const dates = Array.from({ length: 61 }, (_, index) => addLocalDays(today, index - 30));
  const scrollRef = React.useRef<ScrollView>(null);
  const selectedIndex = Math.max(0, dates.indexOf(value.slice(0, 10)));
  const centerSelected = () => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ y: Math.max(0, selectedIndex * 48 - 168), animated: false });
    });
  };
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
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
              <Text style={styles.secondaryText}>取消</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

function SwipeSummaryRow({
  item,
  canEdit,
  onEdit,
  onViewPhoto,
  onDelete,
}: {
  item: CashTransaction;
  canEdit: boolean;
  onEdit: () => void;
  onViewPhoto: () => void;
  onDelete: () => void;
}) {
  return (
    <Swipeable
      friction={2}
      rightThreshold={32}
      renderRightActions={() => canEdit ? (
        <View style={styles.swipeActions}>
          <Pressable style={styles.swipeEdit} onPress={() => { void tapFeedback('编辑'); onEdit(); }}><Text style={styles.swipeActionText}>编辑</Text></Pressable>
          <Pressable style={styles.swipeDelete} onPress={() => { void tapFeedback('删除'); onDelete(); }}><Text style={styles.swipeDeleteText}>删除</Text></Pressable>
        </View>
      ) : null}>
      <View style={styles.summaryItem}>
        <View style={styles.summaryItemHeader}>
          <Text style={[styles.summaryItemTitle, transactionAmountStyle(item)]}>{transactionTitleAmount(item)}</Text>
          {!canEdit ? <Text style={styles.readOnlyBadge}>只读</Text> : null}
        </View>
        <Text style={styles.summaryItemText}>{recordDateTime(item)} / {labelType(item.type)} / {transactionDescription(item)}</Text>
        <Text style={styles.summaryItemMeta}>{item.created_by_name || item.created_by}</Text>
        {item.photo_uri ? (
          <Pressable style={styles.photoLinkButton} onPress={() => { void tapFeedback('照片'); onViewPhoto(); }}>
            <Text style={styles.photoLinkText}>查看照片</Text>
          </Pressable>
        ) : null}
      </View>
    </Swipeable>
  );
}

function CopySummaryBlock({
  children,
  date,
  daily,
  overview,
  summary,
  expectedUsd,
  expectedLrd,
  title,
  actualUsdText,
  actualLrdText,
  includePeople,
  transactions,
}: React.PropsWithChildren<{
  date: string;
  daily: DailyCash | null;
  overview: DailyCashOverview | null;
  summary: DailySummary;
  expectedUsd: number;
  expectedLrd: number;
  title: string;
  actualUsdText: string;
  actualLrdText: string;
  includePeople: boolean;
  transactions: CashTransaction[];
}>) {
  const [lastTap, setLastTap] = useState(0);
  const hasExchange = transactions.some((item) => item.type === 'exchange');
  const expenseCount = transactions.filter((item) => item.type === 'expense').length;
  const cashInCount = transactions.filter((item) => item.type === 'cash_in').length;
  const transferCount = transactions.filter((item) => item.type === 'transfer').length;
  const exchangeCount = transactions.filter((item) => item.type === 'exchange').length;
  const itemLines = transactions.map((item) => `- ${labelType(item.type)} ${formatTransactionAmount(item)} ${transactionDescription(item)}`.trim());
  const summaryLines = [
    `${title} ${date}`,
    `初始：USD ${money(overview?.initial_usd ?? 0)} / LRD ${money(overview?.initial_lrd ?? 0)}`,
    `收入：USD ${money(summary.cash_in_usd)} / LRD ${money(summary.cash_in_lrd)}`,
    `支出：USD ${money(summary.cash_out_usd)} / LRD ${money(summary.cash_out_lrd)}`,
  ];
  if (hasExchange) {
    summaryLines.push(`兑换入：USD ${money(summary.exchange_in_usd)} / LRD ${money(summary.exchange_in_lrd)}`);
    summaryLines.push(`兑换出：USD ${money(summary.exchange_out_usd)} / LRD ${money(summary.exchange_out_lrd)}`);
  }
  const copyText = [
    ...summaryLines,
    `应有：USD ${money(expectedUsd)} / LRD ${money(expectedLrd)}`,
    `实际剩余：USD ${actualUsdText} / LRD ${actualLrdText}`,
    `共 ${transactions.length} 笔：收入 ${cashInCount}，支出 ${expenseCount}，转账 ${transferCount}，兑换 ${exchangeCount}。`,
    ...(includePeople && overview?.users.length ? ['人员汇总：', ...overview.users.map((item) => `- ${item.name}: USD ${money(item.balance_usd)} / LRD ${money(item.balance_lrd)}`)] : []),
    '简要明细：',
    ...(itemLines.length ? itemLines : ['- 当天没有记录']),
  ].join('\n');

  const onPress = async () => {
    const now = Date.now();
    if (now - lastTap < 360) {
      await Clipboard.setStringAsync(copyText);
      void successFeedback('已复制');
      Alert.alert('已复制', '当日汇总和明细已复制。');
    } else {
      void tapFeedback('汇总');
    }
    setLastTap(now);
  };

  return (
    <Pressable style={styles.summary} onPress={onPress}>
      {children}
    </Pressable>
  );
}

function photoFileName(title: string) {
  return `${title.replace(/[^a-zA-Z0-9_-]/g, '_') || 'cashbox-photo'}.jpg`;
}

async function localPhotoUriForSave(uri: string, title: string) {
  if (uri.startsWith('file://')) return uri;
  const localUri = `${FileSystem.cacheDirectory}${photoFileName(title)}`;
  const result = await FileSystem.downloadAsync(uri, localUri);
  return result.uri;
}

function PhotoViewer({ title, uri, onClose }: { title: string; uri: string; onClose: () => void }) {
  const [saving, setSaving] = useState(false);

  const savePhoto = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const permission = await MediaLibrary.requestPermissionsAsync(true);
      if (!permission.granted) {
        Alert.alert('需要权限', '请允许保存照片后再下载。');
        return;
      }
      const localUri = await localPhotoUriForSave(uri, title);
      await MediaLibrary.saveToLibraryAsync(localUri);
      void successFeedback('照片已保存');
      Alert.alert('已保存', '照片已保存到相册。');
    } catch {
      Alert.alert('保存失败', '无法保存这张照片，请稍后重试。');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible animationType="fade" presentationStyle="fullScreen">
      <SafeAreaView style={styles.viewerScreen}>
        <View style={styles.viewerHeader}>
          <Text style={styles.viewerTitle}>{title}</Text>
          <Pressable style={styles.viewerHeaderButton} onPress={() => { void tapFeedback('关闭照片'); onClose(); }}>
            <Text style={styles.viewerHeaderButtonText}>关闭</Text>
          </Pressable>
        </View>
        <View style={styles.viewerImageWrap}>
          <Image source={{ uri }} style={styles.viewerImage} resizeMode="contain" />
        </View>
        <View style={styles.viewerFooter}>
          <Pressable style={styles.downloadButton} onPress={() => { void tapFeedback('下载照片'); void savePhoto(); }}>
            <Text style={styles.downloadButtonText}>{saving ? '保存中...' : '下载照片'}</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

function EditModal({ transaction, onClose, onSaved }: { transaction: CashTransaction; onClose: () => void; onSaved: () => void }) {
  const initialPayment = paymentParts(transaction);
  const [amount, setAmount] = useState(String(transaction.amount));
  const [currency, setCurrency] = useState<Currency>(transaction.currency);
  const [paymentUsd, setPaymentUsd] = useState(initialPayment.usd > 0 ? String(initialPayment.usd) : '');
  const [paymentLrd, setPaymentLrd] = useState(initialPayment.lrd > 0 ? String(initialPayment.lrd) : '');
  const [changeUsd, setChangeUsd] = useState(transaction.change_usd ? String(transaction.change_usd) : '');
  const [changeLrd, setChangeLrd] = useState(transaction.change_lrd ? String(transaction.change_lrd) : '');
  const [category, setCategory] = useState(transaction.category);
  const [area, setArea] = useState<Area>((transaction.area as Area) ?? '矿区');
  const [note, setNote] = useState(transaction.note ?? '');
  const [date, setDate] = useState(transaction.date);
  const [fromAmount, setFromAmount] = useState(String(transaction.from_amount ?? transaction.amount));
  const [toAmount, setToAmount] = useState(String(transaction.to_amount ?? ''));
  const [photoUri, setPhotoUri] = useState<string | null>(transaction.photo_uri);
  const [previewUri, setPreviewUri] = useState<string | null>(transaction.photo_uri?.startsWith('storage://') ? null : transaction.photo_uri);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [editDateOpen, setEditDateOpen] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const categories = useMemo(() => (transaction.type === 'expense' ? EXPENSE_CATEGORIES : CASH_IN_CATEGORIES), [transaction.type]);

  React.useEffect(() => {
    let mounted = true;
    void resolvePhotoUri(photoUri).then((uri) => {
      if (mounted) setPreviewUri(uri);
    });
    return () => {
      mounted = false;
    };
  }, [photoUri]);

  const pickPhoto = async (source: 'camera' | 'library') => {
    const permission = source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('需要权限', source === 'camera' ? '请允许相机权限后拍照。' : '请允许相册权限后选择照片。');
      return;
    }
    const result = source === 'camera'
      ? await ImagePicker.launchCameraAsync({ quality: 0.65 })
      : await ImagePicker.launchImageLibraryAsync({ quality: 0.65, mediaTypes: ['images'] });
    if (!result.canceled) {
      void tapFeedback('选择照片');
      const uri = result.assets[0]?.uri ?? null;
      setPhotoUri(uri);
      setPreviewUri(uri);
    }
  };

  const save = async () => {
    if (transaction.type === 'exchange') {
      const from = Number(fromAmount.replace(/,/g, ''));
      const to = Number(toAmount.replace(/,/g, ''));
      if (!Number.isFinite(from) || !Number.isFinite(to) || from <= 0 || to <= 0) return Alert.alert('金额必填');
      await updateTransaction(transaction.local_transaction_id, {
        amount: from,
        currency: transaction.from_currency ?? currency,
        from_amount: from,
        to_amount: to,
        exchange_rate: to / from,
        note: note.trim() || null,
        date,
        photo_uri: photoUri,
      });
    } else {
      const usdAmount = Number(paymentUsd.replace(/,/g, '')) || 0;
      const lrdAmount = Number(paymentLrd.replace(/,/g, '')) || 0;
      if (transaction.type === 'transfer') {
        const parsedAmount = Number(amount.replace(/,/g, ''));
        if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) return Alert.alert('金额必填');
        await updateTransaction(transaction.local_transaction_id, {
          amount: parsedAmount,
          currency,
          category,
          area: null,
          note: note.trim() || null,
          date,
          photo_uri: photoUri,
        });
      } else {
        if (!Number.isFinite(usdAmount) || !Number.isFinite(lrdAmount) || usdAmount < 0 || lrdAmount < 0 || usdAmount + lrdAmount <= 0) return Alert.alert('金额必填', '请输入 USD 或 LRD 金额，至少一项大于 0。');
        const primaryCurrency: Currency = usdAmount > 0 ? 'USD' : 'LRD';
        const primaryAmount = usdAmount > 0 ? usdAmount : lrdAmount;
        await updateTransaction(transaction.local_transaction_id, {
          amount: primaryAmount,
          currency: primaryCurrency,
          category,
          area: transaction.type === 'expense' ? area : null,
          from_currency: usdAmount > 0 ? 'USD' : null,
          from_amount: usdAmount > 0 ? usdAmount : null,
          to_currency: lrdAmount > 0 ? 'LRD' : null,
          to_amount: lrdAmount > 0 ? lrdAmount : null,
          exchange_rate: null,
          change_usd: transaction.type === 'expense' ? Number(changeUsd.replace(/,/g, '')) || 0 : null,
          change_lrd: transaction.type === 'expense' ? Number(changeLrd.replace(/,/g, '')) || 0 : null,
          note: note.trim() || null,
          date,
          photo_uri: photoUri,
        });
      }
    }
    onClose();
    void successFeedback('保存成功');
    Alert.alert('已保存', '修改已保存，并写入审计日志。');
    onSaved();
  };

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet">
      <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={24}>
      <ScrollView ref={scrollRef} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" contentContainerStyle={styles.modalContent}>
        <Text style={styles.title}>编辑记录</Text>
        {transaction.type === 'exchange' ? (
          <>
            <Field label={`付出金额 ${transaction.from_currency}`} value={fromAmount} onChangeText={setFromAmount} keyboardType="decimal-pad" />
            <Field label={`收到金额 ${transaction.to_currency}`} value={toAmount} onChangeText={setToAmount} keyboardType="decimal-pad" />
          </>
        ) : (
          <>
            {transaction.type === 'transfer' ? (
              <>
                <Field label="金额" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
                <Text style={styles.label}>币种</Text>
                <View style={styles.row}>
                  <Choice label="USD" active={currency === 'USD'} onPress={() => setCurrency('USD')} />
                  <Choice label="LRD" active={currency === 'LRD'} onPress={() => setCurrency('LRD')} />
                </View>
              </>
            ) : (
              <>
                <Text style={styles.label}>金额</Text>
                <View style={styles.twoColumns}>
                  <TextInput style={[styles.input, styles.columnInput]} value={paymentUsd} onChangeText={setPaymentUsd} keyboardType="decimal-pad" placeholder="USD" placeholderTextColor="#8A6F3D" />
                  <TextInput style={[styles.input, styles.columnInput]} value={paymentLrd} onChangeText={setPaymentLrd} keyboardType="decimal-pad" placeholder="LRD" placeholderTextColor="#8A6F3D" />
                </View>
              </>
            )}
            {transaction.type === 'expense' ? (
              <>
                <Text style={styles.label}>发生地点</Text>
                <View style={styles.row}>
                  {AREA_OPTIONS.map((item) => <Choice key={item} label={item} active={area === item} onPress={() => setArea(item)} />)}
                </View>
                <Text style={styles.label}>找零（可选）</Text>
                <View style={styles.twoColumns}>
                  <TextInput style={[styles.input, styles.columnInput]} value={changeUsd} onChangeText={setChangeUsd} keyboardType="decimal-pad" placeholder="找零 USD" placeholderTextColor="#8A6F3D" />
                  <TextInput style={[styles.input, styles.columnInput]} value={changeLrd} onChangeText={setChangeLrd} keyboardType="decimal-pad" placeholder="找零 LRD" placeholderTextColor="#8A6F3D" />
                </View>
              </>
            ) : null}
            <Text style={styles.label}>类别</Text>
            <View style={styles.wrap}>
              {categories.map((item) => <Choice key={item} label={item} active={category === item} onPress={() => setCategory(item)} />)}
            </View>
          </>
        )}
        <DateSelect
          label="日期"
          today={getTodayIso()}
          value={date.slice(0, 10)}
          visible={editDateOpen}
          onOpen={() => setEditDateOpen(true)}
          onClose={() => setEditDateOpen(false)}
          onChange={(nextDate) => setDate(replaceLocalDate(date, nextDate))}
        />
        <Field label="备注" value={note} onChangeText={setNote} multiline onFocus={() => setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 120)} />
        <Text style={styles.label}>照片</Text>
        {previewUri ? (
          <Pressable onPress={() => { void tapFeedback('查看照片'); setViewerOpen(true); }}>
            <Image source={{ uri: previewUri }} style={styles.photoPreview} />
          </Pressable>
        ) : <Text style={styles.emptyPhoto}>当前没有照片。</Text>}
        <View style={styles.wrap}>
          <Choice label="拍照" active={false} onPress={() => pickPhoto('camera')} />
          <Choice label="从相册选择" active={false} onPress={() => pickPhoto('library')} />
          {photoUri ? <Choice label="移除照片" active={false} onPress={() => { setPhotoUri(null); setPreviewUri(null); }} /> : null}
        </View>
        <View style={styles.row}>
          <Pressable style={styles.secondaryButton} onPress={() => { void tapFeedback('取消'); onClose(); }}><Text style={styles.secondaryText}>取消</Text></Pressable>
          <Pressable style={styles.primaryButton} onPress={() => { void tapFeedback('保存'); void save(); }}><Text style={styles.primaryText}>保存</Text></Pressable>
        </View>
      </ScrollView>
      {viewerOpen && previewUri ? <PhotoViewer title={transaction.transaction_no} uri={previewUri} onClose={() => setViewerOpen(false)} /> : null}
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

function Choice({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.choice, active && styles.choiceActive]} onPress={() => { void tapFeedback(label); onPress(); }}>
      <Text style={[styles.choiceText, active && styles.choiceTextActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F6F1E8' },
  content: { padding: 18, paddingTop: 14, paddingBottom: 42 },
  modalContent: { padding: 18, paddingTop: 52, paddingBottom: 160 },
  title: { color: '#111827', fontSize: 30, fontWeight: '900', marginBottom: 14 },
  label: { color: '#374151', fontSize: 13, fontWeight: '900', marginBottom: 8, marginTop: 8 },
  chips: { gap: 8, marginBottom: 12 },
  field: { marginBottom: 8 },
  input: { minHeight: 50, borderRadius: 8, borderWidth: 1.5, borderColor: '#C8A94B', backgroundColor: '#FFFCF5', paddingHorizontal: 12, fontSize: 16, color: '#111827' },
  textArea: { minHeight: 96, paddingTop: 12, textAlignVertical: 'top' },
  photoPreview: { width: '100%', height: 190, borderRadius: 8, backgroundColor: '#E5E7EB', marginTop: 4, marginBottom: 10 },
  emptyPhoto: { color: '#6B7280', fontSize: 13, marginBottom: 8 },
  choice: { minHeight: 42, borderRadius: 8, borderWidth: 1, borderColor: '#D1D5DB', backgroundColor: '#FFFFFF', paddingHorizontal: 13, alignItems: 'center', justifyContent: 'center' },
  choiceActive: { backgroundColor: '#111827', borderColor: '#111827' },
  choiceText: { color: '#374151', fontWeight: '900' },
  choiceTextActive: { color: '#FFFFFF' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  row: { flexDirection: 'row', gap: 10, marginTop: 12 },
  twoColumns: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  columnInput: { flex: 1 },
  summary: { backgroundColor: '#FFFFFF', borderRadius: 8, padding: 14, borderWidth: 1, borderColor: '#E5D9BF', marginBottom: 12 },
  summaryTitle: { color: '#111827', fontSize: 17, fontWeight: '900', marginBottom: 6 },
  summaryLine: { color: '#374151', fontSize: 14, marginTop: 4 },
  summaryStrong: { color: '#111827', fontSize: 15, marginTop: 8, fontWeight: '900' },
  summarySubTitle: { color: '#111827', fontSize: 15, fontWeight: '900', marginTop: 14, marginBottom: 6 },
  summaryItem: { borderTopWidth: 1, borderTopColor: '#E5E7EB', paddingVertical: 10, backgroundColor: '#FFFFFF' },
  summaryItemHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  summaryItemTitle: { color: '#111827', fontSize: 14, fontWeight: '900' },
  summaryItemText: { color: '#4B5563', fontSize: 13, marginTop: 3 },
  summaryItemMeta: { color: '#6B7280', fontSize: 12, marginTop: 3 },
  photoLinkButton: { alignSelf: 'flex-start', minHeight: 34, borderRadius: 8, borderWidth: 1, borderColor: '#C8A94B', backgroundColor: '#FFFCF5', justifyContent: 'center', paddingHorizontal: 10, marginTop: 8 },
  photoLinkText: { color: '#7C5800', fontSize: 12, fontWeight: '900' },
  expenseAmount: { color: '#B91C1C' },
  cashInAmount: { color: '#047857' },
  exchangeAmount: { color: '#1D4ED8' },
  readOnlyBadge: { overflow: 'hidden', borderRadius: 6, backgroundColor: '#E5E7EB', color: '#4B5563', paddingHorizontal: 8, paddingVertical: 3, fontSize: 12, fontWeight: '900' },
  personSummary: { borderTopWidth: 1, borderTopColor: '#E5E7EB', paddingTop: 8, marginTop: 8 },
  personSummaryName: { color: '#111827', fontSize: 14, fontWeight: '900' },
  personSummaryText: { color: '#4B5563', fontSize: 13, marginTop: 3 },
  swipeActions: { width: 136, flexDirection: 'row' },
  swipeEdit: { flex: 1, backgroundColor: '#F3C74D', alignItems: 'center', justifyContent: 'center' },
  swipeDelete: { flex: 1, backgroundColor: '#FEE2E2', alignItems: 'center', justifyContent: 'center' },
  swipeActionText: { color: '#111827', fontWeight: '900' },
  swipeDeleteText: { color: '#991B1B', fontWeight: '900' },
  dateButton: { minHeight: 48, borderRadius: 8, borderWidth: 1, borderColor: '#D1D5DB', backgroundColor: '#FFFFFF', paddingHorizontal: 12, justifyContent: 'center' },
  dateButtonText: { color: '#111827', fontSize: 16, fontWeight: '900' },
  todayText: { color: '#B45309' },
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(17, 24, 39, 0.35)', justifyContent: 'flex-end' },
  dateSheet: { maxHeight: '72%', backgroundColor: '#F6F1E8', borderTopLeftRadius: 8, borderTopRightRadius: 8, padding: 16 },
  sheetTitle: { color: '#111827', fontSize: 20, fontWeight: '900', marginBottom: 10 },
  dateList: { maxHeight: 420 },
  dateOption: { minHeight: 48, borderBottomWidth: 1, borderBottomColor: '#E5D9BF', justifyContent: 'center', paddingHorizontal: 8 },
  dateOptionActive: { backgroundColor: '#111827', borderRadius: 8, borderBottomWidth: 0 },
  dateOptionText: { color: '#374151', fontSize: 17, fontWeight: '900', textAlign: 'center' },
  dateOptionTextActive: { color: '#FFFFFF' },
  card: { backgroundColor: '#FFFFFF', borderRadius: 8, padding: 14, borderWidth: 1, borderColor: '#E5E7EB', marginBottom: 10 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  txnNo: { color: '#111827', fontSize: 16, fontWeight: '900' },
  badge: { overflow: 'hidden', borderRadius: 6, backgroundColor: '#FEE2E2', color: '#991B1B', paddingHorizontal: 8, paddingVertical: 4, fontWeight: '900' },
  goodBadge: { backgroundColor: '#D1FAE5', color: '#065F46' },
  exchangeBadge: { backgroundColor: '#DBEAFE', color: '#1E40AF' },
  amount: { color: '#111827', fontSize: 21, fontWeight: '900', marginTop: 8 },
  meta: { color: '#6B7280', fontSize: 13, marginTop: 4 },
  empty: { color: '#6B7280', textAlign: 'center', marginTop: 24 },
  primaryButton: { flex: 1, minHeight: 50, borderRadius: 8, backgroundColor: '#111827', alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: '#FFFFFF', fontSize: 16, fontWeight: '900' },
  secondaryButton: { flex: 1, minHeight: 50, borderRadius: 8, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#D1D5DB', alignItems: 'center', justifyContent: 'center' },
  secondaryText: { color: '#111827', fontSize: 16, fontWeight: '900' },
  deleteButton: { flex: 1, minHeight: 50, borderRadius: 8, backgroundColor: '#FEE2E2', alignItems: 'center', justifyContent: 'center' },
  deleteText: { color: '#991B1B', fontSize: 16, fontWeight: '900' },
  viewerScreen: { flex: 1, backgroundColor: '#000000' },
  viewerHeader: { minHeight: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingHorizontal: 14 },
  viewerTitle: { flex: 1, color: '#FFFFFF', fontSize: 16, fontWeight: '900' },
  viewerHeaderButton: { minHeight: 40, borderRadius: 8, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  viewerHeaderButtonText: { color: '#111827', fontWeight: '900' },
  viewerImageWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  viewerImage: { width: '100%', height: '100%' },
  viewerFooter: { padding: 14 },
  downloadButton: { minHeight: 50, borderRadius: 8, backgroundColor: '#F3C74D', alignItems: 'center', justifyContent: 'center' },
  downloadButtonText: { color: '#111827', fontSize: 16, fontWeight: '900' },
});

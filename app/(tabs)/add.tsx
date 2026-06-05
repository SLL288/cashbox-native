import { router, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Image, KeyboardAvoidingView, Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { AREA_OPTIONS, CASH_IN_CATEGORIES, EXPENSE_CATEGORIES, createManagerTransfer, createTransaction, getActiveProjectId, getCurrentUser, listProjectUsers, listProjectsForCurrentUser } from '@/lib/db';
import { successFeedback, tapFeedback, warningFeedback } from '@/lib/feedback';
import type { Area, Currency, ProjectUser, TransactionType, User } from '@/lib/types';

const parseAmount = (value: string) => Number(value.replace(/,/g, ''));
const money = (value: number) => value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function paymentLine(usd: number, lrd: number) {
  return [`USD ${money(usd)}`, `LRD ${money(lrd)}`].join(' / ');
}

function savedMessage(lines: string[]) {
  return ['已保存到本机', '有网络时会自动同步。', '', ...lines].join('\n');
}

export default function AddRecordScreen() {
  const params = useLocalSearchParams<{ type?: TransactionType; date?: string }>();
  const [type, setType] = useState<TransactionType>(params.type === 'cash_in' || params.type === 'exchange' || params.type === 'transfer' ? params.type : 'expense');
  const selectedDate = typeof params.date === 'string' ? params.date.slice(0, 10) : undefined;
  const [currency, setCurrency] = useState<Currency>('USD');
  const [amount, setAmount] = useState('');
  const [paymentUsd, setPaymentUsd] = useState('');
  const [paymentLrd, setPaymentLrd] = useState('');
  const [category, setCategory] = useState(EXPENSE_CATEGORIES[0]);
  const [area, setArea] = useState<Area>('矿区');
  const [note, setNote] = useState('');
  const [projectName, setProjectName] = useState('');
  const [fromCurrency, setFromCurrency] = useState<Currency>('USD');
  const [toCurrency, setToCurrency] = useState<Currency>('LRD');
  const [fromAmount, setFromAmount] = useState('');
  const [toAmount, setToAmount] = useState('');
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [assignedUsers, setAssignedUsers] = useState<ProjectUser[]>([]);
  const [toUserId, setToUserId] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [changeUsd, setChangeUsd] = useState('');
  const [changeLrd, setChangeLrd] = useState('');
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    const load = async () => {
      const active = getActiveProjectId();
      const [projects, user, assignments] = await Promise.all([listProjectsForCurrentUser(), getCurrentUser(), listProjectUsers()]);
      setProjectName(projects.find((project) => project.local_project_id === active)?.project_name ?? '');
      setCurrentUser(user);
      const activeAssignments = assignments.filter(
        (item) =>
          item.local_project_id === active &&
          item.local_user_id !== user?.local_user_id &&
          (item.role_in_project === 'manager' || item.role_in_project === 'admin')
      );
      setAssignedUsers(activeAssignments);
      setToUserId((current) => (activeAssignments.some((item) => item.local_user_id === current) ? current : activeAssignments[0]?.local_user_id ?? ''));
    };
    load();
  }, []);

  const categories = useMemo(() => (type === 'expense' ? EXPENSE_CATEGORIES : CASH_IN_CATEGORIES), [type]);
  void currentUser;

  const selectType = (nextType: TransactionType) => {
    setType(nextType);
    if (nextType === 'expense') setCategory(EXPENSE_CATEGORIES[0]);
    if (nextType === 'cash_in') setCategory(CASH_IN_CATEGORIES[0]);
    if (nextType === 'exchange') setCategory('货币兑换');
  };

  const swapCurrencies = () => {
    setFromCurrency(toCurrency);
    setToCurrency(fromCurrency);
  };

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
    if (!result.canceled) setPhotoUri(result.assets[0]?.uri ?? null);
  };

  const save = async () => {
    if (!getActiveProjectId()) {
      void warningFeedback('请先选择项目');
      Alert.alert('请先选择项目', '请回到“今日”页面选择项目进入。');
      router.push('/');
      return;
    }
    if (type === 'exchange') {
      const from = parseAmount(fromAmount);
      const to = parseAmount(toAmount);
      if (!Number.isFinite(from) || !Number.isFinite(to) || from <= 0 || to <= 0) {
        void warningFeedback('请输入金额');
        Alert.alert('金额必填', '请输入兑换前和兑换后的金额。');
        return;
      }
      await createTransaction({
        type,
        category: '货币兑换',
        note,
        fromCurrency,
        fromAmount: from,
        toCurrency,
        toAmount: to,
        photoUri,
        date: selectedDate,
      });
      setFromAmount('');
      setToAmount('');
      setNote('');
      setPhotoUri(null);
      void successFeedback('记录已保存');
      Alert.alert('已保存', savedMessage([
        '类型：货币兑换',
        `付出：${fromCurrency} ${money(from)}`,
        `收到：${toCurrency} ${money(to)}`,
        photoUri ? '照片：已添加' : '照片：无',
      ]));
      return;
    }

    if (type === 'transfer') {
      const parsedAmount = parseAmount(amount);
      if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
        void warningFeedback('请输入金额');
        Alert.alert('金额必填', '请输入大于 0 的金额。');
        return;
      }
      if (!toUserId) {
        void warningFeedback('请选择收款人');
        Alert.alert('请选择收款人', '请选择要转给哪位经理或管理员。');
        return;
      }
      await createManagerTransfer({
        amount: parsedAmount,
        currency,
        toUserId,
        note,
        photoUri,
        date: selectedDate,
      });
      setAmount('');
      setNote('');
      setPhotoUri(null);
      void successFeedback('转账待确认');
      Alert.alert('等待收款人确认', savedMessage([
        '状态：待确认，暂不计入双方余额',
        '类型：内部转账',
        `金额：${currency} ${money(parsedAmount)}`,
        `收款人：${assignedUsers.find((item) => item.local_user_id === toUserId)?.manager_name ?? toUserId}`,
        photoUri ? '照片：已添加' : '照片：无',
      ]));
      return;
    }
    const usdAmount = parseAmount(paymentUsd) || 0;
    const lrdAmount = parseAmount(paymentLrd) || 0;
    if (!Number.isFinite(usdAmount) || !Number.isFinite(lrdAmount) || usdAmount < 0 || lrdAmount < 0 || usdAmount + lrdAmount <= 0) {
      void warningFeedback('请输入金额');
      Alert.alert('金额必填', '请输入 USD 或 LRD 金额，至少一项大于 0。');
      return;
    }
    const primaryCurrency: Currency = usdAmount > 0 ? 'USD' : 'LRD';
    const primaryAmount = usdAmount > 0 ? usdAmount : lrdAmount;
    await createTransaction({
      type,
      amount: primaryAmount,
      currency: primaryCurrency,
      category,
      note,
      area: type === 'expense' ? area : null,
      fromCurrency: usdAmount > 0 ? 'USD' : undefined,
      fromAmount: usdAmount > 0 ? usdAmount : undefined,
      toCurrency: lrdAmount > 0 ? 'LRD' : undefined,
      toAmount: lrdAmount > 0 ? lrdAmount : undefined,
      changeUsd: type === 'expense' ? parseAmount(changeUsd) || 0 : 0,
      changeLrd: type === 'expense' ? parseAmount(changeLrd) || 0 : 0,
      photoUri,
      date: selectedDate,
    });
    setPaymentUsd('');
    setPaymentLrd('');
    setNote('');
    setChangeUsd('');
    setChangeLrd('');
    setPhotoUri(null);
    void successFeedback('记录已保存');
    Alert.alert('已保存', savedMessage([
      `类型：${type === 'expense' ? '支出' : '现金收入'}`,
      `金额：${paymentLine(usdAmount, lrdAmount)}`,
      `类别：${category}`,
      type === 'expense' && (parseAmount(changeUsd) > 0 || parseAmount(changeLrd) > 0) ? `找零：USD ${money(parseAmount(changeUsd) || 0)} / LRD ${money(parseAmount(changeLrd) || 0)}` : '',
      photoUri ? '照片：已添加' : '照片：无',
    ].filter(Boolean)));
  };

  return (
    <SafeAreaView style={styles.screen}>
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={24}>
    <ScrollView ref={scrollRef} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" contentContainerStyle={styles.content}>
      <Text style={styles.title}>新增记录</Text>
      <Text style={styles.subtitle}>{projectName ? `当前项目：${projectName}` : '请先在今日页面选择项目'}</Text>

      <Section title="类型">
        <View style={styles.row}>
          <Choice label="支出" active={type === 'expense'} onPress={() => selectType('expense')} />
          <Choice label="现金收入" active={type === 'cash_in'} onPress={() => selectType('cash_in')} />
          <Choice label="货币兑换" active={type === 'exchange'} onPress={() => selectType('exchange')} />
          <Choice label="内部转账" active={type === 'transfer'} onPress={() => selectType('transfer')} />
        </View>
      </Section>

      {type === 'exchange' ? (
        <>
          <Section title="兑换方向">
            <View style={styles.row}>
              <Choice label={`付出 ${fromCurrency}`} active onPress={swapCurrencies} />
              <Choice label={`收到 ${toCurrency}`} active={false} onPress={swapCurrencies} />
            </View>
          </Section>
          <Section title={`付出金额 ${fromCurrency}`}>
            <TextInput style={styles.input} value={fromAmount} onChangeText={setFromAmount} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor="#8A6F3D" />
          </Section>
          <Section title={`收到金额 ${toCurrency}`}>
            <TextInput style={styles.input} value={toAmount} onChangeText={setToAmount} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor="#8A6F3D" />
          </Section>
        </>
      ) : (
        <>
          {type === 'transfer' ? (
            <>
              <Section title="金额">
                <TextInput style={styles.input} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor="#8A6F3D" />
              </Section>
              <Section title="币种">
                <View style={styles.row}>
                  <Choice label="USD" active={currency === 'USD'} onPress={() => setCurrency('USD')} />
                  <Choice label="LRD" active={currency === 'LRD'} onPress={() => setCurrency('LRD')} />
                </View>
              </Section>
            </>
          ) : (
            <Section title="金额">
              <View style={styles.twoColumns}>
                <TextInput style={[styles.input, styles.columnInput]} value={paymentUsd} onChangeText={setPaymentUsd} keyboardType="decimal-pad" placeholder="USD" placeholderTextColor="#8A6F3D" />
                <TextInput style={[styles.input, styles.columnInput]} value={paymentLrd} onChangeText={setPaymentLrd} keyboardType="decimal-pad" placeholder="LRD" placeholderTextColor="#8A6F3D" />
              </View>
              <Text style={styles.helperText}>同一笔付款可同时填写 USD 和 LRD；没有用到的币种留空。</Text>
            </Section>
          )}
          {type === 'transfer' ? (
            <Section title="收款人">
              <View style={styles.wrap}>
                {assignedUsers.map((item) => (
                  <Choice key={item.local_user_id} label={item.manager_name ?? item.local_user_id} active={toUserId === item.local_user_id} onPress={() => setToUserId(item.local_user_id)} />
                ))}
              </View>
              {assignedUsers.length === 0 ? <Text style={styles.emptyText}>当前项目没有其他可收款的经理或管理员。</Text> : null}
            </Section>
          ) : null}
          {type === 'expense' ? (
            <Section title="发生地点">
              <View style={styles.row}>
                {AREA_OPTIONS.map((item) => (
                  <Choice key={item} label={item} active={area === item} onPress={() => setArea(item)} />
                ))}
              </View>
            </Section>
          ) : null}
          {type === 'expense' ? (
            <Section title="找零（可选）">
              <Text style={styles.helperText}>上面金额填实际付出的现金；收到找零就在这里填，会自动加回余额。</Text>
              <View style={styles.twoColumns}>
                <TextInput style={[styles.input, styles.columnInput]} value={changeUsd} onChangeText={setChangeUsd} keyboardType="decimal-pad" placeholder="找零 USD" placeholderTextColor="#8A6F3D" />
                <TextInput style={[styles.input, styles.columnInput]} value={changeLrd} onChangeText={setChangeLrd} keyboardType="decimal-pad" placeholder="找零 LRD" placeholderTextColor="#8A6F3D" />
              </View>
            </Section>
          ) : null}
          {type !== 'transfer' ? <Section title="类别">
            <View style={styles.wrap}>
              {categories.map((item) => (
                <Choice key={item} label={item} active={category === item} onPress={() => setCategory(item)} />
              ))}
            </View>
          </Section> : null}
        </>
      )}

      <Section title="备注">
        <TextInput
          style={[styles.input, styles.textArea]}
          value={note}
          onChangeText={setNote}
          multiline
          placeholder="可选"
          placeholderTextColor="#8A6F3D"
          onFocus={() => setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 120)}
        />
      </Section>

      <Section title="照片（可选）">
        {photoUri ? <Image source={{ uri: photoUri }} style={styles.photoPreview} /> : null}
        <View style={styles.row}>
          <Choice label="拍照" active={false} onPress={() => pickPhoto('camera')} />
          <Choice label="从相册选择" active={false} onPress={() => pickPhoto('library')} />
          {photoUri ? <Choice label="移除照片" active={false} onPress={() => setPhotoUri(null)} /> : null}
        </View>
      </Section>

      <Pressable style={styles.saveButton} onPress={() => { void tapFeedback('保存'); void save(); }}>
        <Text style={styles.saveText}>保存到本机</Text>
      </Pressable>
    </ScrollView>
    </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Section({ title, children }: React.PropsWithChildren<{ title: string }>) {
  return (
    <View style={styles.section}>
      <Text style={styles.label}>{title}</Text>
      {children}
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
  content: { padding: 18, paddingTop: 14, paddingBottom: 160 },
  title: { color: '#111827', fontSize: 30, fontWeight: '900' },
  subtitle: { color: '#6B7280', fontSize: 15, marginTop: 6, marginBottom: 16 },
  section: { marginBottom: 16 },
  label: { color: '#374151', fontSize: 13, fontWeight: '900', marginBottom: 8 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choice: { minHeight: 44, borderRadius: 8, borderWidth: 1, borderColor: '#D1D5DB', backgroundColor: '#FFFFFF', paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' },
  choiceActive: { backgroundColor: '#111827', borderColor: '#111827' },
  choiceText: { color: '#374151', fontWeight: '900' },
  choiceTextActive: { color: '#FFFFFF' },
  input: { minHeight: 52, borderRadius: 8, borderWidth: 1.5, borderColor: '#C8A94B', backgroundColor: '#FFFCF5', color: '#111827', fontSize: 17, paddingHorizontal: 12 },
  helperText: { color: '#6B7280', fontSize: 12, lineHeight: 18, marginBottom: 8 },
  twoColumns: { flexDirection: 'row', gap: 10 },
  columnInput: { flex: 1 },
  textArea: { minHeight: 96, paddingTop: 12, textAlignVertical: 'top' },
  photoPreview: { width: '100%', height: 180, borderRadius: 8, marginBottom: 10, backgroundColor: '#E5E7EB' },
  saveButton: { minHeight: 56, borderRadius: 8, backgroundColor: '#F3C74D', alignItems: 'center', justifyContent: 'center', marginTop: 6 },
  saveText: { color: '#111827', fontSize: 17, fontWeight: '900' },
  emptyText: { color: '#6B7280', fontSize: 13, marginTop: 8 },
});

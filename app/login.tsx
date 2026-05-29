import { router } from 'expo-router';
import React, { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { login } from '@/lib/db';
import { successFeedback, tapFeedback, warningFeedback } from '@/lib/feedback';
import { pullLoginDataFromSupabase, syncWithSupabase } from '@/lib/sync';
import { notifyAutoSyncComplete, setAutoSyncStatus } from '@/lib/syncSignal';

export default function LoginScreen() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      void tapFeedback('登录');
      let user = await login(username, password);
      if (!user) {
        try {
          setAutoSyncStatus('syncing');
          await pullLoginDataFromSupabase();
          user = await login(username, password);
        } catch {
          setAutoSyncStatus('error');
        }
      }
      if (!user) {
        void warningFeedback('登录失败');
        Alert.alert('登录失败', '用户名或密码不正确。');
        return;
      }
      void successFeedback('登录成功');
      router.replace('/(tabs)');
      setAutoSyncStatus('syncing');
      void syncWithSupabase().then(
        () => {
          setAutoSyncStatus('synced');
          notifyAutoSyncComplete();
        },
        (error) => {
          setAutoSyncStatus('error');
          const message = error instanceof Error ? error.message : String(error);
          Alert.alert('同步失败', `已进入本机离线数据。网络恢复后会继续自动同步。\n\n${message}`);
        }
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.screen}>
    <KeyboardAvoidingView style={styles.keyboard} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
      <Text style={styles.kicker}>本地离线系统</Text>
      <Text style={styles.title}>金矿现金箱</Text>
      <Text style={styles.subtitle}>请登录后选择项目进入。</Text>

      <View style={styles.form}>
        <Text style={styles.label}>用户名</Text>
        <TextInput value={username} onChangeText={setUsername} autoCapitalize="none" autoCorrect={false} autoComplete="off" textContentType="none" style={styles.input} placeholder="请输入用户名" placeholderTextColor="#8A6F3D" />
        <Text style={styles.label}>密码</Text>
        <TextInput value={password} onChangeText={setPassword} secureTextEntry autoCorrect={false} autoComplete="off" textContentType="none" style={styles.input} placeholder="请输入密码" placeholderTextColor="#8A6F3D" />
        <Pressable style={[styles.button, submitting && styles.buttonDisabled]} onPress={submit}>
          <Text style={styles.buttonText}>{submitting ? '登录中...' : '登录'}</Text>
        </Pressable>
      </View>
    </ScrollView>
    </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F6F1E8' },
  keyboard: { flex: 1 },
  content: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 22, paddingTop: 34, paddingBottom: 40 },
  kicker: { color: '#7C5C16', fontSize: 13, fontWeight: '900' },
  title: { color: '#111827', fontSize: 36, fontWeight: '900', marginTop: 6 },
  subtitle: { color: '#6B7280', fontSize: 16, marginTop: 8, marginBottom: 28 },
  form: { backgroundColor: '#FFFFFF', borderRadius: 8, padding: 16, borderWidth: 1, borderColor: '#E5D9BF' },
  label: { color: '#374151', fontSize: 13, fontWeight: '900', marginBottom: 7, marginTop: 10 },
  input: { minHeight: 52, borderRadius: 8, borderWidth: 1.5, borderColor: '#C8A94B', backgroundColor: '#FFFCF5', paddingHorizontal: 12, fontSize: 17, color: '#111827' },
  button: { minHeight: 54, borderRadius: 8, backgroundColor: '#F3C74D', alignItems: 'center', justifyContent: 'center', marginTop: 18 },
  buttonDisabled: { opacity: 0.65 },
  buttonText: { color: '#111827', fontSize: 17, fontWeight: '900' },
});


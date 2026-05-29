import { Ionicons } from '@expo/vector-icons';
import { Redirect, Tabs } from 'expo-router';
import React, { useEffect, useState } from 'react';

import { getCurrentUser, getCurrentUserId, initDb, subscribeAuth } from '@/lib/db';
import { startAutoSync } from '@/lib/autoSync';
import { tapFeedback } from '@/lib/feedback';
import type { User } from '@/lib/types';

export default function TabLayout() {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    const stopAutoSync = startAutoSync();
    const load = async () => {
      await initDb();
      setUser(await getCurrentUser());
      setReady(true);
    };
    load();
    const unsubscribeAuth = subscribeAuth(load);
    return () => {
      unsubscribeAuth();
      stopAutoSync();
    };
  }, []);

  if (!ready) return null;
  if (!getCurrentUserId()) return <Redirect href="/login" />;

  return (
    <Tabs
      screenListeners={{
        tabPress: () => {
          void tapFeedback();
        },
      }}
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#7C5C16',
        tabBarInactiveTintColor: '#6B7280',
        tabBarStyle: { backgroundColor: '#FFFFFF', borderTopColor: '#E5D9BF' },
      }}>
      <Tabs.Screen name="index" options={{ title: '今日', tabBarIcon: ({ color, size }) => <Ionicons name="home-outline" size={size} color={color} /> }} />
      <Tabs.Screen name="add" options={{ title: '新增', href: user?.role === 'viewer' ? null : undefined, tabBarIcon: ({ color, size }) => <Ionicons name="add-circle-outline" size={size} color={color} /> }} />
      <Tabs.Screen name="history" options={{ title: '历史', tabBarIcon: ({ color, size }) => <Ionicons name="time-outline" size={size} color={color} /> }} />
      <Tabs.Screen name="admin" options={{ title: '管理', href: user?.role === 'admin' ? undefined : null, tabBarIcon: ({ color, size }) => <Ionicons name="settings-outline" size={size} color={color} /> }} />
      <Tabs.Screen name="explore" options={{ href: null }} />
    </Tabs>
  );
}

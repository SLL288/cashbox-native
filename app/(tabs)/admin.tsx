import { useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  assignManager,
  createManager,
  deleteProject,
  getCurrentUser,
  listAuditLog,
  listProjectAssignableUsers,
  listProjectUsers,
  listProjectsForCurrentUser,
  removeManagerAssignment,
  updateProject,
  updateUser,
} from '@/lib/db';
import { successFeedback, tapFeedback, warningFeedback } from '@/lib/feedback';
import { subscribeAutoSyncComplete } from '@/lib/syncSignal';
import type { AuditLog, Project, ProjectUser, User } from '@/lib/types';

export default function AdminScreen() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [managers, setManagers] = useState<User[]>([]);
  const [newRole, setNewRole] = useState<'manager' | 'viewer'>('manager');
  const [assignments, setAssignments] = useState<ProjectUser[]>([]);
  const [audit, setAudit] = useState<AuditLog[]>([]);

  const [editProjectId, setEditProjectId] = useState('');
  const [editProjectName, setEditProjectName] = useState('');
  const [editLocation, setEditLocation] = useState('');

  const [newUsername, setNewUsername] = useState('');
  const [newManagerName, setNewManagerName] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [editManagerId, setEditManagerId] = useState('');
  const [editUsername, setEditUsername] = useState('');
  const [editManagerName, setEditManagerName] = useState('');
  const [editPassword, setEditPassword] = useState('');

  const [assignProjectId, setAssignProjectId] = useState('');
  const [assignManagerId, setAssignManagerId] = useState('');

  const load = useCallback(async () => {
    const [user, projectRows, managerRows, assignmentRows, auditRows] = await Promise.all([
      getCurrentUser(),
      listProjectsForCurrentUser(),
      listProjectAssignableUsers(),
      listProjectUsers(),
      listAuditLog(),
    ]);
    setCurrentUser(user);
    setProjects(projectRows);
    setManagers(managerRows);
    setAssignments(assignmentRows);
    setAudit(auditRows);
    const project = projectRows.find((item) => item.local_project_id === editProjectId) ?? projectRows[0];
    if (project) {
      setEditProjectId(project.local_project_id);
      setEditProjectName(project.project_name);
      setEditLocation(project.location ?? '');
    }
    const manager = managerRows.find((item) => item.local_user_id === editManagerId) ?? managerRows[0];
    if (manager) {
      setEditManagerId(manager.local_user_id);
      setEditUsername(manager.username);
      setEditManagerName(manager.name);
      setEditPassword(manager.password ?? '');
    }
    setAssignProjectId((current) => (projectRows.some((item) => item.local_project_id === current) ? current : projectRows[0]?.local_project_id ?? ''));
    setAssignManagerId((current) => (managerRows.some((item) => item.local_user_id === current) ? current : managerRows[0]?.local_user_id ?? ''));
  }, [editManagerId, editProjectId]);

  useFocusEffect(useCallback(() => void load(), [load]));
  React.useEffect(() => subscribeAutoSyncComplete(load), [load]);

  if (currentUser?.role !== 'admin') {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>没有权限</Text>
        <Text style={styles.subtitle}>只有管理员可以进入管理页面。</Text>
      </View>
    );
  }

  const chooseProject = (project: Project) => {
    setEditProjectId(project.local_project_id);
    setEditProjectName(project.project_name);
    setEditLocation(project.location ?? '');
  };

  const saveProjectEdit = async () => {
    const project = projects.find((item) => item.local_project_id === editProjectId);
    if (!project || !editProjectName.trim()) {
      void warningFeedback('请填写项目名称');
      return Alert.alert('请选择项目并填写名称');
    }
    await updateProject(project, { project_name: editProjectName, location: editLocation });
    void successFeedback('项目已保存');
    Alert.alert('已保存', '项目已修改。');
    load();
  };

  const deleteProjectAction = () => {
    const project = projects.find((item) => item.local_project_id === editProjectId);
    if (!project) {
      void warningFeedback('请选择项目');
      return Alert.alert('请选择项目');
    }
    Alert.alert('删除项目', `确定删除 ${project.project_name} 吗？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          void tapFeedback('确认删除');
          await deleteProject(project);
          void successFeedback('项目已删除');
          Alert.alert('已删除', '项目已停用，并写入审计日志。');
          load();
        },
      },
    ]);
  };

  const createManagerAction = async () => {
    if (!newUsername.trim() || !newManagerName.trim() || !newPassword) {
      void warningFeedback('请填写完整信息');
      return Alert.alert('用户名、姓名、密码都必填');
    }
    await createManager(newUsername, newManagerName, newPassword, newRole);
    setNewUsername('');
    setNewManagerName('');
    setNewPassword('');
    void successFeedback(newRole === 'viewer' ? '查看员已创建' : '经理已创建');
    Alert.alert('已保存', newRole === 'viewer' ? '查看员账号已创建。' : '经理账号已创建。');
    load();
  };

  const chooseManager = (manager: User) => {
    setEditManagerId(manager.local_user_id);
    setEditUsername(manager.username);
    setEditManagerName(manager.name);
    setEditPassword(manager.password ?? '');
  };

  const saveManagerEdit = async () => {
    const manager = managers.find((item) => item.local_user_id === editManagerId);
    if (!manager || !editUsername.trim() || !editManagerName.trim() || !editPassword) {
      void warningFeedback('请填写完整信息');
      return Alert.alert('请选择经理并填写完整信息');
    }
    await updateUser(manager, { username: editUsername, name: editManagerName, password: editPassword });
    void successFeedback('账号已保存');
    Alert.alert('已保存', '经理账号已修改。');
    load();
  };

  const assignAction = async () => {
    if (!assignProjectId || !assignManagerId) {
      void warningFeedback('请选择项目和人员');
      return Alert.alert('请选择项目和人员');
    }
    await assignManager(assignProjectId, assignManagerId);
    void successFeedback('分配已保存');
    Alert.alert('已保存', '人员已分配到项目。');
    load();
  };

  const removeAssignmentAction = (assignment: ProjectUser) => {
    void tapFeedback('移除分配');
    Alert.alert('移除分配', `确定移除 ${assignment.manager_name} - ${assignment.project_name} 吗？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '移除',
        style: 'destructive',
        onPress: async () => {
          void tapFeedback('确认移除');
          await removeManagerAssignment(assignment);
          void successFeedback('分配已移除');
          Alert.alert('已移除', '经理项目分配已移除。');
          load();
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.screen}>
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
    <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" contentContainerStyle={styles.content}>
      <Text style={styles.title}>管理</Text>
      <Text style={styles.subtitle}>管理员：创建、修改、删除项目，并分配经理或查看员。</Text>

      <Card title="编辑 / 删除项目">
        <View style={styles.wrap}>
          {projects.map((project) => <Choice key={project.local_project_id} label={project.project_name} active={editProjectId === project.local_project_id} onPress={() => chooseProject(project)} />)}
        </View>
        <Field label="项目名称" value={editProjectName} onChangeText={setEditProjectName} />
        <Field label="地点" value={editLocation} onChangeText={setEditLocation} />
        <View style={styles.row}>
          <PrimaryButton label="保存修改" onPress={saveProjectEdit} />
          <DangerButton label="删除项目" onPress={deleteProjectAction} />
        </View>
      </Card>

      <Card title="创建经理 / 查看员">
        <Text style={styles.label}>账号类型</Text>
        <View style={styles.wrap}>
          <Choice label="经理" active={newRole === 'manager'} onPress={() => setNewRole('manager')} />
          <Choice label="查看员" active={newRole === 'viewer'} onPress={() => setNewRole('viewer')} />
        </View>
        <Field label="登录用户名" value={newUsername} onChangeText={setNewUsername} autoCapitalize="none" />
        <Field label="姓名" value={newManagerName} onChangeText={setNewManagerName} />
        <Field label="密码" value={newPassword} onChangeText={setNewPassword} />
        <PrimaryButton label={newRole === 'viewer' ? '创建查看员' : '创建经理'} onPress={createManagerAction} />
      </Card>

      <Card title="编辑经理 / 查看员">
        <View style={styles.wrap}>
          {managers.map((manager) => <Choice key={manager.local_user_id} label={`${manager.name} (${manager.role === 'viewer' ? '查看员' : '经理'})`} active={editManagerId === manager.local_user_id} onPress={() => chooseManager(manager)} />)}
        </View>
        <Field label="登录用户名" value={editUsername} onChangeText={setEditUsername} autoCapitalize="none" />
        <Field label="姓名" value={editManagerName} onChangeText={setEditManagerName} />
        <Field label="密码" value={editPassword} onChangeText={setEditPassword} />
        <PrimaryButton label="保存账号" onPress={saveManagerEdit} />
      </Card>

      <Card title="分配经理 / 查看员到项目">
        <Text style={styles.label}>项目</Text>
        <View style={styles.wrap}>
          {projects.map((project) => <Choice key={project.local_project_id} label={project.project_name} active={assignProjectId === project.local_project_id} onPress={() => setAssignProjectId(project.local_project_id)} />)}
        </View>
        <Text style={styles.label}>人员</Text>
        <View style={styles.wrap}>
          {managers.map((manager) => <Choice key={manager.local_user_id} label={`${manager.name} (${manager.role === 'viewer' ? '查看员' : '经理'})`} active={assignManagerId === manager.local_user_id} onPress={() => setAssignManagerId(manager.local_user_id)} />)}
        </View>
        <PrimaryButton label="确认分配" onPress={assignAction} />
        <Text style={styles.subheading}>当前分配</Text>
        {assignments.map((assignment) => (
          <View key={`${assignment.local_project_id}-${assignment.local_user_id}`} style={styles.listRow}>
            <View style={styles.listText}>
              <Text style={styles.listTitle}>{assignment.manager_name}</Text>
              <Text style={styles.listMeta}>{assignment.project_name}</Text>
            </View>
            <Pressable style={styles.smallDangerButton} onPress={() => removeAssignmentAction(assignment)}>
              <Text style={styles.smallDangerText}>移除</Text>
            </Pressable>
          </View>
        ))}
      </Card>

      <Card title="审计日志">
        {audit.map((item) => (
          <View key={item.local_audit_id} style={styles.auditRow}>
            <Text style={styles.auditTitle}>{item.action.toUpperCase()} {item.table_name}</Text>
            <Text style={styles.listMeta}>{item.edited_by_name || item.edited_by || '系统'} - {new Date(item.edited_at_local).toLocaleString()}</Text>
            <Text numberOfLines={2} style={styles.auditJson}>{item.new_value_json || item.old_value_json || ''}</Text>
          </View>
        ))}
      </Card>
    </ScrollView>
    </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Card({ title, children }: React.PropsWithChildren<{ title: string }>) {
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.card}>
      <Pressable style={styles.cardHeader} onPress={() => { void tapFeedback(title); setOpen((value) => !value); }}>
        <Text style={styles.cardTitle}>{title}</Text>
        <Text style={styles.cardToggle}>{open ? '收起' : '展开'}</Text>
      </Pressable>
      {open ? children : null}
    </View>
  );
}

function Field(props: React.ComponentProps<typeof TextInput> & { label: string }) {
  const { label, ...inputProps } = props;
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput {...inputProps} placeholderTextColor="#8A6F3D" style={styles.input} />
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

function PrimaryButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable style={styles.primaryButton} onPress={() => { void tapFeedback(label); onPress(); }}>
      <Text style={styles.primaryText}>{label}</Text>
    </Pressable>
  );
}

function DangerButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable style={styles.dangerButton} onPress={() => { void tapFeedback(label); onPress(); }}>
      <Text style={styles.dangerText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F6F1E8' },
  center: { flex: 1, backgroundColor: '#F6F1E8', alignItems: 'center', justifyContent: 'center', padding: 20 },
  content: { padding: 18, paddingTop: 14, paddingBottom: 160 },
  title: { color: '#111827', fontSize: 30, fontWeight: '900' },
  subtitle: { color: '#6B7280', marginTop: 4, marginBottom: 14 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 8, padding: 14, borderWidth: 1, borderColor: '#E5D9BF', marginBottom: 12 },
  cardHeader: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  cardTitle: { color: '#111827', fontSize: 18, fontWeight: '900', flex: 1 },
  cardToggle: { color: '#7C5C16', fontSize: 14, fontWeight: '900' },
  field: { marginBottom: 10 },
  label: { color: '#374151', fontSize: 13, fontWeight: '900', marginBottom: 8 },
  subheading: { color: '#111827', fontSize: 16, fontWeight: '900', marginTop: 18, marginBottom: 6 },
  input: { minHeight: 50, borderRadius: 8, borderWidth: 1.5, borderColor: '#C8A94B', backgroundColor: '#FFFCF5', color: '#111827', fontSize: 16, paddingHorizontal: 12 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  row: { flexDirection: 'row', gap: 10 },
  choice: { minHeight: 42, borderRadius: 8, borderWidth: 1, borderColor: '#D1D5DB', backgroundColor: '#FFFFFF', paddingHorizontal: 13, alignItems: 'center', justifyContent: 'center' },
  choiceActive: { backgroundColor: '#111827', borderColor: '#111827' },
  choiceText: { color: '#374151', fontWeight: '900' },
  choiceTextActive: { color: '#FFFFFF' },
  primaryButton: { flex: 1, minHeight: 52, borderRadius: 8, backgroundColor: '#F3C74D', alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  primaryText: { color: '#111827', fontSize: 16, fontWeight: '900' },
  dangerButton: { flex: 1, minHeight: 52, borderRadius: 8, backgroundColor: '#FEE2E2', alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  dangerText: { color: '#991B1B', fontSize: 16, fontWeight: '900' },
  listRow: { borderTopWidth: 1, borderTopColor: '#E5E7EB', paddingVertical: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  listText: { flex: 1 },
  listTitle: { color: '#111827', fontSize: 16, fontWeight: '900' },
  listMeta: { color: '#6B7280', fontSize: 13, marginTop: 3 },
  smallDangerButton: { minHeight: 38, borderRadius: 8, backgroundColor: '#FEE2E2', paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  smallDangerText: { color: '#991B1B', fontWeight: '900' },
  auditRow: { borderTopWidth: 1, borderTopColor: '#E5E7EB', paddingVertical: 10 },
  auditTitle: { color: '#111827', fontWeight: '900' },
  auditJson: { color: '#4B5563', fontSize: 12, marginTop: 4 },
});

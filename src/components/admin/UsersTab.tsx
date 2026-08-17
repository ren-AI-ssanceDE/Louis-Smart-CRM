import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'motion/react';
import { 
  Users, 
  UserPlus, 
  Edit, 
  Trash2, 
  Loader2, 
  Mail, 
  Key, 
  Shield, 
  X
} from 'lucide-react';
import { trpc } from '../../lib/trpc';
import { toast } from 'sonner';

interface UserItem {
  id_uuid?: string;
  email_address?: string;
  full_legal_name?: string;
  account_role?: string;
  created_at_utc?: string | Date | null;
  updated_at_utc?: string | Date | null;
}

export const UsersTab = () => {
  const { t } = useTranslation(['admin', 'common']);
  const utils = trpc.useContext();

  const { data: sessionData } = trpc.getSession.useQuery();
  const { data: users = [], isLoading } = trpc.getUsers.useQuery();

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserItem | null>(null);

  // Form State
  const [fullName, setFullName] = useState('');
  const [emailAddress, setEmailAddress] = useState('');
  const [role, setRole] = useState<'admin' | 'staff' | 'system'>('staff');
  const [password, setPassword] = useState('');

  // Delete Confirm State
  const [userToDelete, setUserToDelete] = useState<UserItem | null>(null);

  const createUserMutation = trpc.createUser.useMutation({
    onSuccess: (data) => {
      toast.success(data.message || t('admin:users.toast_create_success'));
      closeForm();
      utils.getUsers.invalidate();
    },
    onError: (err) => {
      toast.error(err.message);
    }
  });

  const updateUserMutation = trpc.updateUser.useMutation({
    onSuccess: (data) => {
      toast.success(data.message || t('admin:users.toast_update_success'));
      closeForm();
      utils.getUsers.invalidate();
    },
    onError: (err) => {
      toast.error(err.message);
    }
  });

  const deleteUserMutation = trpc.deleteUser.useMutation({
    onSuccess: (data) => {
      toast.success(data.message || t('admin:users.toast_delete_success'));
      setUserToDelete(null);
      utils.getUsers.invalidate();
    },
    onError: (err) => {
      toast.error(err.message);
    }
  });

  const openAddForm = () => {
    setEditingUser(null);
    setFullName('');
    setEmailAddress('');
    setRole('staff');
    setPassword('');
    setIsFormOpen(true);
  };

  const openEditForm = (user: UserItem) => {
    setEditingUser(user);
    setFullName(user.full_legal_name || '');
    setEmailAddress(user.email_address || '');
    setRole((user.account_role as 'admin' | 'staff' | 'system') || 'staff');
    setPassword('');
    setIsFormOpen(true);
  };

  const closeForm = () => {
    setIsFormOpen(false);
    setEditingUser(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim()) {
      toast.error(t('common:last_name_required') || 'Name ist erforderlich');
      return;
    }
    if (!emailAddress.trim()) {
      toast.error(t('admin:toast_email_required_error') || 'E-Mail ist erforderlich');
      return;
    }

    if (editingUser) {
      updateUserMutation.mutate({
        id_uuid: editingUser.id_uuid || '',
        full_legal_name: fullName.trim(),
        email_address: emailAddress.trim(),
        account_role: role,
        password: password.trim() || undefined,
      });
    } else {
      if (!password.trim()) {
        toast.error(t('common:password_required', { defaultValue: 'Passwort ist erforderlich' }));
        return;
      }
      createUserMutation.mutate({
        full_legal_name: fullName.trim(),
        email_address: emailAddress.trim(),
        account_role: role,
        password: password.trim(),
      });
    }
  };

  const handleDelete = (user: UserItem) => {
    if (sessionData?.user?.id === user.id_uuid) {
      toast.error(t('admin:users.toast_delete_self_error'));
      return;
    }
    setUserToDelete(user);
  };

  const confirmDelete = () => {
    if (userToDelete && userToDelete.id_uuid) {
      deleteUserMutation.mutate({ id_uuid: userToDelete.id_uuid });
    }
  };

  const getRoleLabel = (roleStr: string) => {
    switch (roleStr) {
      case 'admin':
        return t('admin:users.role_admin');
      case 'staff':
        return t('admin:users.role_staff');
      case 'system':
        return t('admin:users.role_system');
      default:
        return roleStr;
    }
  };

  const getRoleBadgeClass = (roleStr: string) => {
    switch (roleStr) {
      case 'admin':
        return 'bg-accent-orange/15 text-accent-orange border border-accent-orange/20';
      case 'staff':
        return 'bg-accent-blue/15 text-accent-blue border border-accent-blue/20';
      case 'system':
        return 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20';
      default:
        return 'bg-slate-500/15 text-slate-400 border border-white/5';
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="text-accent-orange animate-spin" size={40} />
      </div>
    );
  }

  return (
    <div className="space-y-8 font-sans">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="flex items-center gap-6">
          <div className="p-5 bg-accent-orange/10 rounded-2xl border border-accent-orange/20 shadow-lg shadow-accent-orange/10">
            <Users className="text-accent-orange" size={32} />
          </div>
          <div>
            <h3 className="text-4xl font-black text-white italic uppercase tracking-tighter font-display">
              {t('admin:users.title')}
            </h3>
            <p className="text-slate-500 text-xs font-bold italic opacity-70 tracking-wider font-display uppercase">
              {t('admin:users.desc')}
            </p>
          </div>
        </div>
        {!isFormOpen && (
          <button
            onClick={openAddForm}
            className="flex items-center gap-2 bg-gradient-to-r from-accent-orange to-[#ff8c4a] text-white px-6 py-3.5 rounded-xl font-black uppercase text-[11px] tracking-widest hover:brightness-110 active:scale-[0.98] transition-all shadow-xl shadow-accent-orange/25"
          >
            <UserPlus size={16} />
            {t('admin:users.add_user_btn')}
          </button>
        )}
      </div>

      {isFormOpen ? (
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-primary-dark/40 border border-white/5 p-8 rounded-2xl shadow-2xl relative overflow-hidden"
        >
          <div className="absolute top-6 right-6">
            <button
              onClick={closeForm}
              className="text-slate-500 hover:text-white p-2 hover:bg-white/5 rounded-xl transition-all"
            >
              <X size={20} />
            </button>
          </div>

          <h4 className="text-2xl font-black text-white mb-6 font-display uppercase italic tracking-tight">
            {editingUser ? t('admin:users.edit_user_title') : t('admin:users.add_user_title')}
          </h4>

          <form onSubmit={handleSubmit} className="space-y-6 max-w-2xl">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest font-display">
                  {t('admin:users.full_name')} *
                </label>
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full bg-primary-dark/80 border border-white/10 rounded-xl px-5 py-3.5 text-white font-bold placeholder-slate-600 focus:outline-none focus:border-accent-orange/50 transition-all text-sm"
                />
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest font-display">
                  {t('admin:users.email_address')} *
                </label>
                <div className="relative">
                  <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
                  <input
                    type="email"
                    required
                    value={emailAddress}
                    onChange={(e) => setEmailAddress(e.target.value)}
                    className="w-full bg-primary-dark/80 border border-white/10 rounded-xl pl-12 pr-5 py-3.5 text-white font-bold placeholder-slate-600 focus:outline-none focus:border-accent-orange/50 transition-all text-sm"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest font-display">
                  {t('admin:users.role')}
                </label>
                <div className="relative">
                  <Shield className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
                  <select
                    value={role}
                    onChange={(e) => setRole(e.target.value as 'admin' | 'staff' | 'system')}
                    className="w-full bg-primary-dark/80 border border-white/10 rounded-xl pl-12 pr-5 py-3.5 text-white font-bold focus:outline-none focus:border-accent-orange/50 transition-all text-sm appearance-none"
                  >
                    <option value="staff" className="bg-primary-dark">{t('admin:users.role_staff')}</option>
                    <option value="admin" className="bg-primary-dark">{t('admin:users.role_admin')}</option>
                    <option value="system" className="bg-primary-dark">{t('admin:users.role_system')}</option>
                  </select>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest font-display flex justify-between items-center">
                  <span>{t('admin:users.password')} {editingUser && '(Optional)'}</span>
                  {editingUser && (
                    <span className="text-[8px] font-bold text-slate-600 tracking-normal lowercase italic normal-case">
                      {t('admin:users.password_help')}
                    </span>
                  )}
                </label>
                <div className="relative">
                  <Key className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
                  <input
                    type="password"
                    required={!editingUser}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={editingUser ? '••••••••' : ''}
                    className="w-full bg-primary-dark/80 border border-white/10 rounded-xl pl-12 pr-5 py-3.5 text-white font-bold placeholder-slate-600 focus:outline-none focus:border-accent-orange/50 transition-all text-sm"
                  />
                </div>
              </div>
            </div>

            <div className="flex gap-4 pt-4 border-t border-white/5">
              <button
                type="submit"
                disabled={createUserMutation.isPending || updateUserMutation.isPending}
                className="flex items-center gap-2 bg-gradient-to-r from-accent-orange to-[#ff8c4a] text-white px-6 py-3.5 rounded-xl font-black uppercase text-[11px] tracking-widest hover:brightness-110 active:scale-[0.98] transition-all shadow-xl shadow-accent-orange/25 disabled:opacity-50"
              >
                {(createUserMutation.isPending || updateUserMutation.isPending) && (
                  <Loader2 size={14} className="animate-spin" />
                )}
                {t('common:save')}
              </button>
              <button
                type="button"
                onClick={closeForm}
                className="bg-white/5 hover:bg-white/10 border border-white/10 text-white px-6 py-3.5 rounded-xl font-black uppercase text-[11px] tracking-widest transition-all"
              >
                {t('common:cancel')}
              </button>
            </div>
          </form>
        </motion.div>
      ) : (
        <div className="bg-primary-dark/20 border border-white/5 rounded-2xl overflow-hidden shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-white/5 bg-primary-light/10">
                  <th className="px-6 py-4.5 text-[10px] font-black text-slate-500 uppercase tracking-widest font-display">
                    {t('admin:users.table_name')}
                  </th>
                  <th className="px-6 py-4.5 text-[10px] font-black text-slate-500 uppercase tracking-widest font-display">
                    {t('admin:users.table_email')}
                  </th>
                  <th className="px-6 py-4.5 text-[10px] font-black text-slate-500 uppercase tracking-widest font-display">
                    {t('admin:users.table_role')}
                  </th>
                  <th className="px-6 py-4.5 text-[10px] font-black text-slate-500 uppercase tracking-widest font-display text-right">
                    {t('admin:users.table_actions')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {users.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-6 py-12 text-center text-slate-600 font-bold italic text-sm">
                      {t('admin:users.no_users_found')}
                    </td>
                  </tr>
                ) : (
                  users.map((user: UserItem) => {
                    const isSelf = sessionData?.user?.id === user.id_uuid;
                    return (
                      <tr 
                        key={user.id_uuid}
                        className="hover:bg-white/[0.01] transition-all"
                      >
                        <td className="px-6 py-5">
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-xl bg-accent-orange/10 flex items-center justify-center text-accent-orange font-black text-sm border border-accent-orange/20">
                              {(user.full_legal_name || 'U').charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <div className="font-bold text-white text-sm flex items-center gap-2">
                                {user.full_legal_name || ''}
                                {isSelf && (
                                  <span className="text-[8px] bg-white/10 border border-white/15 px-1.5 py-0.5 rounded-full font-black text-slate-400 uppercase tracking-wider font-display scale-90">
                                    Du
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-5 text-slate-300 text-sm font-semibold">
                          {user.email_address || ''}
                        </td>
                        <td className="px-6 py-5">
                          <span className={`px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-wider font-display ${getRoleBadgeClass(user.account_role || 'staff')}`}>
                            {getRoleLabel(user.account_role || 'staff')}
                          </span>
                        </td>
                        <td className="px-6 py-5 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => openEditForm(user)}
                              className="p-2 text-slate-400 hover:text-white hover:bg-white/5 rounded-xl transition-all"
                              title={t('common:edit') || 'Bearbeiten'}
                            >
                              <Edit size={16} />
                            </button>
                            <button
                              onClick={() => handleDelete(user)}
                              disabled={isSelf}
                              className={`p-2 rounded-xl transition-all ${
                                isSelf 
                                  ? 'text-slate-700 cursor-not-allowed opacity-30' 
                                  : 'text-rose-500/80 hover:text-rose-400 hover:bg-rose-500/5'
                              }`}
                              title={t('common:delete') || 'Löschen'}
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      {userToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="w-full max-w-md bg-[#131722] border border-white/10 p-8 rounded-2xl shadow-2xl relative overflow-hidden"
          >
            <h4 className="text-xl font-black text-white mb-3 font-display uppercase italic tracking-tight text-rose-500">
              {t('admin:users.delete_confirm_title')}
            </h4>
            <p className="text-slate-400 text-sm font-medium leading-relaxed mb-6">
              {t('admin:users.delete_confirm_desc', { name: userToDelete.full_legal_name || '' })}
            </p>
            <div className="flex justify-end gap-3 pt-4 border-t border-white/5">
              <button
                onClick={confirmDelete}
                disabled={deleteUserMutation.isPending}
                className="flex items-center gap-2 bg-rose-600 hover:bg-rose-500 text-white px-5 py-3 rounded-xl font-black uppercase text-[10px] tracking-widest transition-all disabled:opacity-50"
              >
                {deleteUserMutation.isPending && <Loader2 size={12} className="animate-spin" />}
                {t('common:yes')}
              </button>
              <button
                onClick={() => setUserToDelete(null)}
                className="bg-white/5 hover:bg-white/10 border border-white/10 text-white px-5 py-3 rounded-xl font-black uppercase text-[10px] tracking-widest transition-all"
              >
                {t('common:no')}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
};

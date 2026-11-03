// Who can see this household. Server functions check that the caller is a member.

import { api } from './supabase.js';

export const listMembers = () => api('rpc/household_members', { method: 'POST', body: {} });
export const inviteMember = email => api('rpc/invite_member', { method: 'POST', body: { member_email: email } });
export const removeMember = email => api('rpc/remove_member', { method: 'POST', body: { member_email: email } });

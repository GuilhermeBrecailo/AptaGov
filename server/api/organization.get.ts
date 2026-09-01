import { defineEventHandler } from 'h3';
import { requireAuth } from '../utils/app';

export default defineEventHandler((event) => {
  const context = requireAuth(event);
  return { organization: context.organization, role: context.role };
});

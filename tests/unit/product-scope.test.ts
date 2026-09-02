import { describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env';

describe('escopo do produto', () => {
  it('não expõe configuração de IA, Telegram ou notificações', () => {
    const env = loadEnv({ DATABASE_URL: ':memory:' });

    expect(env.openAiApiKey).toBe('');
    expect(env.openAiModelFast).toBe('gpt-4o-mini');
    expect(env.openAiMonthlyBudgetUsd).toBe(0);
    expect(env.aiEnabled).toBe(false);
    expect(env).not.toHaveProperty('telegramBotToken');
    expect(env).not.toHaveProperty('telegramChatId');
    expect(env.maxNotificationsPerHour).toBe(100);
  });
});

import { describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env';

describe('escopo do produto', () => {
  it('não expõe configuração de IA, Telegram ou notificações', () => {
    const env = loadEnv({ DATABASE_URL: ':memory:' });

    expect(env).not.toHaveProperty('openAiApiKey');
    expect(env).not.toHaveProperty('openAiModel');
    expect(env).not.toHaveProperty('openAiMonthlyBudgetUsd');
    expect(env).not.toHaveProperty('telegramBotToken');
    expect(env).not.toHaveProperty('telegramChatId');
    expect(env.maxNotificationsPerHour).toBe(100);
  });
});

/**
 * Тесты файла обмена конфигурацией: патч стора и fallback-разбор.
 * Desktop-валидацию формата покрывают Rust-тесты `ConfigShareFile`.
 */
import { describe, expect, it } from 'vitest';

import type { AppConfigDto } from '@/api/contracts';
import {
  buildConfigPatch,
  ConfigFileError,
  CONFIG_FILE_FORMAT,
  CONFIG_FILE_VERSION,
  parseConfigFileContent,
  renderConfigFile,
} from '@/lib/configExchange';

function sampleConfig(): AppConfigDto {
  return {
    theme: 'dark',
    language: 'en',
    globalMode: true,
    savedContactIds: ['g1'],
    ldapConfigs: [
      {
        organization: 'КМАруда',
        ldapUrl: 'ldaps://dc1.kmaruda.ru',
        baseDn: 'dc=kmaruda,dc=ru',
        bindDn: null,
        useStartTls: false,
        allowInvalidTls: true,
        useIntegratedAuth: true,
        hasPassword: true,
      },
    ],
    testMode: false,
    animationsEnabled: false,
    syncIntervalHours: 6,
    hideEmptyContacts: false,
    emailOverrides: { g2: 'svc@kmaruda.ru' },
    orgGroups: [{ id: 'grp-1', name: 'Холдинг', orgs: ['КМАруда', 'Глобал Строй'] }],
    enterpriseGroupId: 'grp-1',
    externalPhonebookPath: 'C:\\PhoneBook\\yealink.xml',
    externalPhonebookEnabled: true,
    version: '0.2.0',
  };
}

describe('buildConfigPatch', () => {
  it('переносит все поля и сбрасывает чужие флаги паролей', () => {
    const patch = buildConfigPatch(sampleConfig());
    expect(patch.theme).toBe('dark');
    expect(patch.language).toBe('en');
    expect(patch.globalMode).toBe(true);
    expect(patch.syncIntervalHours).toBe(6);
    expect(patch.externalPhonebookPath).toBe('C:\\PhoneBook\\yealink.xml');
    expect(patch.externalPhonebookEnabled).toBe(true);
    expect(patch.orgGroups).toHaveLength(1);
    expect(patch.enterpriseGroupId).toBe('grp-1');
    // Секреты не переносятся: флаг hasPassword гасится.
    expect(patch.ldapConfigs[0].hasPassword).toBe(false);
    expect(patch.ldapConfigs[0].allowInvalidTls).toBe(true);
  });
});

describe('parseConfigFileContent', () => {
  const errorMessage = 'не файл конфигурации';

  it('разбирает файл, собранный renderConfigFile', () => {
    const content = renderConfigFile(buildConfigPatch(sampleConfig()));
    const dto = parseConfigFileContent(content, errorMessage);
    expect(dto.theme).toBe('dark');
    expect(dto.externalPhonebookEnabled).toBe(true);
    expect(dto.ldapConfigs[0].hasPassword).toBe(false);
    expect(dto.orgGroups[0].name).toBe('Холдинг');
  });

  it('отклоняет чужой JSON, битый JSON и файлы будущих версий', () => {
    expect(() => parseConfigFileContent('{ not json', errorMessage)).toThrow(ConfigFileError);
    expect(() => parseConfigFileContent('{"format":"other","version":1,"config":{}}', errorMessage)).toThrow(
      ConfigFileError,
    );
    expect(() =>
      parseConfigFileContent(
        JSON.stringify({ format: CONFIG_FILE_FORMAT, version: CONFIG_FILE_VERSION + 1, config: {} }),
        errorMessage,
      ),
    ).toThrow(ConfigFileError);
    expect(() =>
      parseConfigFileContent(JSON.stringify({ format: CONFIG_FILE_FORMAT, version: 1 }), errorMessage),
    ).toThrow(ConfigFileError);
  });

  it('подставляет дефолты по отсутствующим полям конфига', () => {
    const dto = parseConfigFileContent(
      JSON.stringify({ format: CONFIG_FILE_FORMAT, version: 1, config: { theme: 'light' } }),
      errorMessage,
    );
    expect(dto.theme).toBe('light');
    expect(dto.language).toBe('ru');
    expect(dto.syncIntervalHours).toBe(24);
    expect(dto.hideEmptyContacts).toBe(true);
    expect(dto.ldapConfigs).toEqual([]);
    expect(dto.externalPhonebookPath).toBeNull();
    expect(dto.externalPhonebookEnabled).toBe(false);
  });

  it('отфильтровывает некорректные элементы списков', () => {
    const dto = parseConfigFileContent(
      JSON.stringify({
        format: CONFIG_FILE_FORMAT,
        version: 1,
        config: {
          savedContactIds: ['g1', 42, null],
          orgGroups: [{ id: 'a', name: 'A', orgs: ['X', 7] }, 'junk'],
          emailOverrides: { g1: 'ok@kmaruda.ru', g2: 5 },
        },
      }),
      errorMessage,
    );
    expect(dto.savedContactIds).toEqual(['g1']);
    expect(dto.orgGroups).toHaveLength(1);
    expect(dto.orgGroups[0].orgs).toEqual(['X']);
    expect(dto.emailOverrides).toEqual({ g1: 'ok@kmaruda.ru' });
  });
});

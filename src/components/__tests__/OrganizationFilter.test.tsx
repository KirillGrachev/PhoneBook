import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { OrganizationFilter } from '@/components/OrganizationFilter';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const GROUPS = [
  { id: 'g1', name: 'КМАруда', orgs: ['АО "Комбинат КМАруда"', 'ООО "Рудник Северный"'] },
  { id: 'g2', name: 'Пустая', orgs: [] },
];
const ORGS = ['АО "Комбинат КМАруда"', 'ООО "Рудник Северный"', 'АО Глобал Строй'];

describe('OrganizationFilter', () => {
  it('группа заменяет поглощённые организации в дропдауне', async () => {
    const user = userEvent.setup();
    render(
      <OrganizationFilter
        organizations={ORGS}
        groups={GROUPS}
        selectedOrg={null}
        selectedGroupId={null}
        onSelect={vi.fn()}
        onSelectGroup={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'filterByOrg' }));

    // Группа с организациями видна, пустая группа — нет.
    expect(screen.getByRole('menuitem', { name: /КМАруда/ })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: /Пустая/ })).toBeNull();

    // Поглощённые организации скрыты, свободная — видна.
    expect(screen.queryByRole('menuitem', { name: 'АО "Комбинат КМАруда"' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'ООО "Рудник Северный"' })).toBeNull();
    expect(screen.getByRole('menuitem', { name: 'АО Глобал Строй' })).toBeTruthy();
  });

  it('выбор группы и сброс вызывают onSelectGroup', async () => {
    const user = userEvent.setup();
    const onSelectGroup = vi.fn();
    render(
      <OrganizationFilter
        organizations={ORGS}
        groups={GROUPS}
        selectedOrg={null}
        selectedGroupId={null}
        onSelect={vi.fn()}
        onSelectGroup={onSelectGroup}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'filterByOrg' }));
    await user.click(screen.getByRole('menuitem', { name: /КМАруда/ }));
    expect(onSelectGroup).toHaveBeenLastCalledWith('g1');
  });
});

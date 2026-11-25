import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Avatar } from '@/components/ui/Avatar';
import { useAppStore } from '@/store/useAppStore';

const PHOTO =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

afterEach(() => {
  useAppStore.setState({ showAvatars: true });
});

describe('Avatar', () => {
  it('shows the photo when avatars are enabled', () => {
    useAppStore.setState({ showAvatars: true });
    const { container } = render(<Avatar fullName="Ivanov Ivan" photoUrl={PHOTO} />);
    expect(container.querySelector('img')).not.toBeNull();
    expect(screen.getByRole('img', { name: 'Ivanov Ivan' })).toBeInTheDocument();
  });

  it('falls back to the letter when avatars are disabled', () => {
    useAppStore.setState({ showAvatars: false });
    const { container } = render(<Avatar fullName="Ivanov Ivan" photoUrl={PHOTO} />);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('I')).toBeInTheDocument();
  });

  it('shows the letter when there is no photo', () => {
    const { container } = render(<Avatar fullName="Petrov Petr" photoUrl={null} />);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('P')).toBeInTheDocument();
  });
});

import * as migration_20260730_171420_initial from './20260730_171420_initial';
import * as migration_20260813_000000_user_theme from './20260813_000000_user_theme';

export const migrations = [
  {
    up: migration_20260730_171420_initial.up,
    down: migration_20260730_171420_initial.down,
    name: '20260730_171420_initial'
  },
  {
    up: migration_20260813_000000_user_theme.up,
    down: migration_20260813_000000_user_theme.down,
    name: '20260813_000000_user_theme'
  },
];

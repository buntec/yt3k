import { describe, expect, it } from 'vitest';
import { foldForSearch } from './search';

describe('foldForSearch', () => {
  it('drops diacritics and case', () => {
    expect(foldForSearch('Délicieuse Music')).toBe('delicieuse music');
    expect(foldForSearch('Ñandú Über Ça')).toBe('nandu uber ca');
  });

  it('matches a plain query against accented text', () => {
    expect(foldForSearch('Délicieuse Music').includes(foldForSearch('delic'))).toBe(true);
    expect(foldForSearch('Delicieuse').includes(foldForSearch('DÉLIC'))).toBe(true);
  });
});

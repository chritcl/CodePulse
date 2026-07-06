import { beforeEach, describe, expect, it } from 'vitest';
import {
  readBoolean,
  readEnum,
  readNumber,
  readString,
  hasStorageValue,
  writeBoolean,
  writeNumber,
  writeString,
} from './storage';

describe('storage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('读取缺失布尔值时返回默认值', () => {
    expect(readBoolean('missing', true)).toBe(true);
  });

  it('以字符串形式写入并读取布尔值', () => {
    writeBoolean('enabled', true);

    expect(localStorage.getItem('enabled')).toBe('true');
    expect(readBoolean('enabled', false)).toBe(true);
  });

  it('读取非法数字时返回默认值', () => {
    localStorage.setItem('opacity', 'abc');

    expect(readNumber('opacity', 100)).toBe(100);
  });

  it('读取缺失数字时返回默认值', () => {
    expect(readNumber('missing_opacity', 100)).toBe(100);
  });

  it('读取枚举值时过滤非法内容', () => {
    localStorage.setItem('theme', 'blue');

    expect(readEnum('theme', 'black', ['black', 'white'] as const)).toBe('black');
  });

  it('读取字符串时保留已有内容', () => {
    localStorage.setItem('player', 'netease');

    expect(readString('player', 'spotify')).toBe('netease');
  });

  it('以字符串形式写入数字', () => {
    writeNumber('opacity', 86);

    expect(localStorage.getItem('opacity')).toBe('86');
  });

  it('写入字符串内容', () => {
    writeString('player', 'spotify');

    expect(localStorage.getItem('player')).toBe('spotify');
  });

  it('判断 key 是否已经存在', () => {
    expect(hasStorageValue('missing')).toBe(false);

    localStorage.setItem('exists', '');

    expect(hasStorageValue('exists')).toBe(true);
  });
});

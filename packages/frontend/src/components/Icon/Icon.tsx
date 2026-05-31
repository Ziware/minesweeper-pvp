import React from 'react';
import mineIconUrl from '../../../../content/mine-icon.svg?url';
import headquartersIconUrl from '../../../../content/headquarters-icon.svg?url';
import styles from './Icon.module.css';

export type IconName = 'mine' | 'headquarters';

const ICON_URLS: Record<IconName, string> = {
  mine: mineIconUrl,
  headquarters: headquartersIconUrl,
};

const ICON_ALT: Record<IconName, string> = {
  mine: 'Мина',
  headquarters: 'Штаб',
};

interface IconProps {
  name: IconName;
  /** Размер в em (по умолчанию 1em — совпадает с текстом рядом). */
  size?: string | number;
  className?: string;
  style?: React.CSSProperties;
  title?: string;
}

/**
 * Универсальная иконка из `packages/content/*.svg`.
 * По размеру и базовому выравниванию ведёт себя как inline-emoji,
 * поэтому может подменять 💣 / 🏛️ без правок раскладки.
 */
export function Icon({ name, size = '1em', className, style, title }: IconProps) {
  const dimension = typeof size === 'number' ? `${size}px` : size;
  return (
    <img
      src={ICON_URLS[name]}
      alt={title ?? ICON_ALT[name]}
      className={[styles.icon, className].filter(Boolean).join(' ')}
      style={{ width: dimension, height: dimension, ...style }}
      draggable={false}
    />
  );
}

import React from 'react';
import mineIconRaw from '../../../../content/mine-icon.svg?raw';
import headquartersIconRaw from '../../../../content/headquarters-icon.svg?raw';
import styles from './Icon.module.css';

export type IconName = 'mine' | 'headquarters';

// Чистим исходный SVG: убираем фиксированные width/height и xml/doctype
// заголовки, чтобы размер задавался через CSS-обёртку и иконка корректно
// масштабировалась внутри клеток любого размера.
function prepareSvg(raw: string): string {
  return raw
    .replace(/<\?xml[^?]*\?>/g, '')
    .replace(/<!DOCTYPE[^>]*>/g, '')
    .replace(/<svg([^>]*)>/, (_match, attrs: string) => {
      const cleaned = attrs
        .replace(/\swidth="[^"]*"/g, '')
        .replace(/\sheight="[^"]*"/g, '');
      return `<svg${cleaned} width="100%" height="100%" preserveAspectRatio="xMidYMid meet">`;
    })
    .trim();
}

const ICON_HTML: Record<IconName, string> = {
  mine: prepareSvg(mineIconRaw),
  headquarters: prepareSvg(headquartersIconRaw),
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
 * SVG встраивается прямо в DOM (без `<img>` и декодирования картинки),
 * поэтому массовые ре-рендеры доски (например, после установки мины)
 * не вызывают мерцания иконок.
 */
function IconImpl({ name, size = '1em', className, style, title }: IconProps) {
  const dimension = typeof size === 'number' ? `${size}px` : size;
  return (
    <span
      className={[styles.icon, className].filter(Boolean).join(' ')}
      style={{ width: dimension, height: dimension, ...style }}
      role="img"
      aria-label={title ?? ICON_ALT[name]}
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: ICON_HTML[name] }}
    />
  );
}

export const Icon = React.memo(IconImpl);

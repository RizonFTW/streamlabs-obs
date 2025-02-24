import React, { HTMLAttributes } from 'react';
import { TPlatform } from '../../services/platforms';
import cx from 'classnames';
import css from './PlatformLogo.m.less';

const sizeMap = {
  small: 14,
  medium: 40,
};

interface IProps {
  platform: TPlatform | 'nimotv' | 'dlive' | 'streamlabs';
  size?: keyof typeof sizeMap | number;
  color?: string;
  nocolor?: boolean;
  unwrapped?: boolean;
  trovo?: boolean;
}

export default function PlatformLogo(p: IProps & HTMLAttributes<unknown>) {
  function iconForPlatform() {
    return {
      twitch: 'fab fa-twitch',
      youtube: 'fab fa-youtube',
      facebook: 'fab fa-facebook',
      tiktok: 'fab fa-tiktok',
      trovo: 'fab fa-trovo',
      dlive: 'dlive',
      nimotv: 'nimotv',
      streamlabs: 'icon-streamlabs',
    }[p.platform];
  }
  const size = p.size && (sizeMap[p.size] ?? p.size);
  const sizeStyle = size
    ? { fontSize: `${size}px`, maxHeight: `${size}px`, maxWidth: `${size}px` }
    : undefined;
  const colorStyle = p.color ? { color: p.color } : undefined;
  const style = { ...sizeStyle, ...colorStyle };
  return (
    <>
      {p.trovo ? (
        <i className={cx('icon-trovo', p.className)} />
      ) : (
        <i
          className={cx(iconForPlatform(), !p.nocolor && css[p.platform], p.className, {
            // Trovo doesn't provide an SVG, so just use different colored PNGs
            [css['trovo--black']]: p.platform === 'trovo' && p.color === 'black',
          })}
          style={style}
        />
      )}
    </>
  );
}

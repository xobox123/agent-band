import { useState } from 'react';
import { parseAvatar } from '../data/adapt.ts';
import type { AvatarSpec } from '../data/types.ts';

const COLORS = ['av-1', 'av-2', 'av-3', 'av-4', 'av-5', 'av-6', 'av-7', 'av-8'];

export function initialsOf(name: string): string {
  const parts = name
    .trim()
    .split(/[\s._-]+/)
    .filter(Boolean);
  const letters = parts.length > 1 ? (parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '') : name.trim().slice(0, 2);
  return letters.toUpperCase() || '?';
}

export function colorOf(name: string): string {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return COLORS[hash % COLORS.length] ?? 'av-1';
}

interface Props {
  name: string;
  avatar?: AvatarSpec | string | null;
  size?: number;
}

export function Avatar({ name, avatar: avatarProp, size = 22 }: Props) {
  const [broken, setBroken] = useState(false);
  const avatar = typeof avatarProp === 'string' ? parseAvatar(avatarProp) : avatarProp;
  const url = avatar?.url && /^https?:\/\//.test(avatar.url) && !broken ? avatar.url : null;
  const color = avatar?.color && COLORS.includes(avatar.color) ? avatar.color : colorOf(name);
  const initials = avatar?.initials ?? initialsOf(name);

  if (url) {
    return (
      <img
        className="avatar"
        src={url}
        alt={name}
        width={size}
        height={size}
        onError={() => {
          setBroken(true);
        }}
      />
    );
  }
  return (
    <span
      className="avatar"
      role="img"
      aria-label={name}
      title={name}
      style={{ width: size, height: size, background: `var(--${color})`, fontSize: size * 0.42 }}
    >
      {initials}
    </span>
  );
}

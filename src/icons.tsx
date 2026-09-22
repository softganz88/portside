import type { ReactNode } from "react";

function Icon({ size = 16, children }: { size?: number; children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const SearchIcon = () => (
  <Icon>
    <circle cx="7" cy="7" r="4.5" />
    <path d="M10.5 10.5 14 14" />
  </Icon>
);

export const PauseIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M5.5 3v10M10.5 3v10" />
  </Icon>
);

export const PlayIcon = () => (
  <Icon>
    <path d="M4.5 3 13 8l-8.5 5z" />
  </Icon>
);

export const RefreshIcon = () => (
  <Icon>
    <path d="M13.5 8A5.5 5.5 0 1 1 11.9 4.1" />
    <path d="M13.5 2v3.5H10" />
  </Icon>
);

export const LockIcon = ({ size = 12 }: { size?: number }) => (
  <Icon size={size}>
    <rect x="3" y="7" width="10" height="7" rx="1.5" />
    <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
  </Icon>
);

export const XIcon = () => (
  <Icon>
    <path d="m4 4 8 8M12 4l-8 8" />
  </Icon>
);

export const CheckIcon = () => (
  <Icon>
    <path d="m3 8.5 3.5 3.5L13 4.5" />
  </Icon>
);

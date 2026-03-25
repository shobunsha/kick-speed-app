import type { ButtonHTMLAttributes, ReactNode } from 'react';

type PrimaryButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  variant?: 'primary' | 'secondary';
};

export function PrimaryButton({
  children,
  className,
  variant = 'primary',
  ...props
}: PrimaryButtonProps) {
  const classes = ['primaryButton', variant === 'secondary' ? 'secondaryButton' : '', className]
    .filter(Boolean)
    .join(' ');

  return (
    <button type="button" className={classes} {...props}>
      {children}
    </button>
  );
}

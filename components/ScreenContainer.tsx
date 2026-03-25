import type { ReactNode } from 'react';

type ScreenContainerProps = {
  eyebrow: string;
  title: string;
  description: string;
  footer?: string;
  children: ReactNode;
};

export function ScreenContainer({
  eyebrow,
  title,
  description,
  footer,
  children,
}: ScreenContainerProps) {
  return (
    <div className="screenWrap">
      <section className="screenCard">
        <header className="screenHeader">
          <p className="eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          <p className="lead">{description}</p>
        </header>
        {children}
        {footer && <p className="screenFooter">{footer}</p>}
      </section>
    </div>
  );
}

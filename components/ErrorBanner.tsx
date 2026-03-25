type ErrorBannerProps = {
  message: string;
};

export function ErrorBanner({ message }: ErrorBannerProps) {
  return (
    <div className="errorBanner" role="alert">
      <strong>エラー:</strong> {message}
    </div>
  );
}

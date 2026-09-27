import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Unhandled React Error in ErrorBoundary:', error, errorInfo);
  }

  private handleReload = () => {
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="min-h-[50vh] flex items-center justify-center p-6 text-center">
          <div className="max-w-md w-full bg-white rounded-3xl border border-slate-200 shadow-xl p-8 space-y-4">
            <div className="w-14 h-14 mx-auto rounded-2xl bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-600 text-2xl">
              ⚠️
            </div>
            <h2 className="text-xl font-black text-[#031E56]">
              Произошла непредвиденная ошибка
            </h2>
            <p className="text-sm text-slate-500 leading-relaxed">
              Сервис временно не смог отобразить этот экран. Попробуйте обновить страницу или вернуться позже.
            </p>
            {this.state.error?.message && (
              <pre className="text-xs bg-slate-50 text-slate-600 p-3 rounded-xl overflow-x-auto text-left max-h-24">
                {this.state.error.message}
              </pre>
            )}
            <button
              type="button"
              onClick={this.handleReload}
              className="w-full py-3 px-5 rounded-xl bg-[#003B73] hover:bg-[#002D5A] text-white font-bold text-sm shadow-md transition-all active:scale-95 cursor-pointer"
            >
              Перезагрузить страницу
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

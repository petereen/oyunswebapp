import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle, XCircle, Bug } from "lucide-react";

// Extend Window interface for Telegram WebApp


interface DiagnosticInfo {
  telegramAvailable: boolean;
  initDataExists: boolean;
  userExists: boolean;
  userId?: number;
  userName?: string;
  apiBaseUrl: string;
  environment: string;
}

export function TelegramDiagnostic() {
  const isDevMode = import.meta.env.VITE_DEV_MODE === 'true';

  // Hide entirely in dev mode — the diagnostic only matters inside Telegram
  if (isDevMode) return null;

  const [info, setInfo] = useState<DiagnosticInfo | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [debugResult, setDebugResult] = useState<any>(null);
  const [debugLoading, setDebugLoading] = useState(false);

  const runDebug = async () => {
    setDebugResult({ message: "Auth disabled - running in dev mode" });
  };

  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    const user = tg?.initDataUnsafe?.user;

    setInfo({
      telegramAvailable: !!tg,
      initDataExists: !!tg?.initData,
      userExists: !!user,
      userId: user?.id,
      userName: user?.first_name || user?.username,
      apiBaseUrl: import.meta.env.VITE_API_BASE || "/api",
      environment: import.meta.env.MODE || "production",
    });
  }, []);

  if (!info) return null;

  const allGood = info.telegramAvailable && info.initDataExists && info.userExists;

  return (
    <div className="fixed bottom-4 right-4 z-50">
      <button
        onClick={() => setShowDetails(!showDetails)}
        className={`p-3 rounded-full shadow-lg transition ${
          allGood
            ? "bg-green-500 hover:bg-green-600"
            : "bg-red-500 hover:bg-red-600"
        } text-white`}
        title="Telegram Diagnostic"
      >
        {allGood ? (
          <CheckCircle className="w-6 h-6" />
        ) : (
          <AlertCircle className="w-6 h-6" />
        )}
      </button>

      {showDetails && (
        <div className="absolute bottom-16 right-0 bg-white rounded-lg shadow-xl p-4 w-80 text-sm border border-slate-200">
          <h3 className="font-bold mb-3 text-slate-700">Telegram Status</h3>
          
          <div className="space-y-2 text-xs">
            <div className="flex items-center gap-2">
              {info.telegramAvailable ? (
                <CheckCircle className="w-4 h-4 text-green-500" />
              ) : (
                <XCircle className="w-4 h-4 text-red-500" />
              )}
              <span>Telegram SDK: {info.telegramAvailable ? "✅" : "❌"}</span>
            </div>

            <div className="flex items-center gap-2">
              {info.initDataExists ? (
                <CheckCircle className="w-4 h-4 text-green-500" />
              ) : (
                <XCircle className="w-4 h-4 text-red-500" />
              )}
              <span>initData: {info.initDataExists ? "✅" : "❌"}</span>
            </div>

            <div className="flex items-center gap-2">
              {info.userExists ? (
                <CheckCircle className="w-4 h-4 text-green-500" />
              ) : (
                <XCircle className="w-4 h-4 text-red-500" />
              )}
              <span>User: {info.userExists ? `✅ (${info.userId})` : "❌"}</span>
            </div>

            <div className="mt-3 pt-3 border-t border-slate-200 space-y-2">
              <div>
                <span className="text-slate-500">User ID:</span>
                <div className="font-mono bg-slate-100 p-2 rounded mt-1 break-all">
                  {info.userId || "N/A"}
                </div>
              </div>

              <div>
                <span className="text-slate-500">API Base:</span>
                <div className="font-mono bg-slate-100 p-2 rounded mt-1 break-all text-xs">
                  {info.apiBaseUrl}
                </div>
              </div>

              <div>
                <span className="text-slate-500">Environment:</span>
                <div className="font-mono bg-slate-100 p-2 rounded mt-1">
                  {info.environment}
                </div>
              </div>
            </div>

            {!allGood && (
              <div className="mt-3 pt-3 border-t border-red-200 bg-red-50 p-2 rounded text-red-700">
                <strong>Common Issues:</strong>
                <ul className="list-disc list-inside mt-2 space-y-1">
                  {!info.telegramAvailable && (
                    <li>Telegram WebApp SDK not loaded</li>
                  )}
                  {!info.initDataExists && (
                    <li>Not running in Telegram Mini App</li>
                  )}
                  {!info.userExists && (
                    <li>User data not available from Telegram</li>
                  )}
                </ul>
              </div>
            )}

            {/* Debug Button */}
            <div className="mt-3 pt-3 border-t border-slate-200">
              <button 
                onClick={runDebug}
                disabled={debugLoading || !info.initDataExists}
                className="w-full bg-slate-800 text-white py-2 rounded flex items-center justify-center gap-2 hover:bg-slate-700 disabled:opacity-50"
              >
                <Bug className="w-4 h-4" />
                {debugLoading ? "Checking..." : "Run Auth Debug"}
              </button>
            </div>

            {/* Debug Result */}
            {debugResult && (
              <div className="mt-2 p-2 bg-slate-100 rounded text-[10px] font-mono overflow-auto max-h-40">
                <pre>{JSON.stringify(debugResult, null, 2)}</pre>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

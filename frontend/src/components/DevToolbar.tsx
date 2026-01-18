import React from 'react';

export const DevToolbar: React.FC = () => {
  // Only show in dev mode
  if (import.meta.env.VITE_DEV_MODE !== 'true') {
    return null;
  }

  const setUserMode = () => {
    localStorage.setItem("oyuns_dev_user", JSON.stringify({
      id: 123456789,
      first_name: "Dev",
      last_name: "User",
      username: "dev_user"
    }));
    window.location.reload();
  };

  const setAdminMode = () => {
    localStorage.setItem("oyuns_dev_user", JSON.stringify({
      id: 1932946217, // ID matched from backend/config.py ADMIN_USER_IDS
      first_name: "Dev",
      last_name: "Admin",
      username: "dev_admin"
    }));
    window.location.reload();
  };

  return (
    <div className="fixed bottom-4 left-4 bg-gray-800 text-white p-3 rounded-lg shadow-xl z-50 flex flex-col gap-2 border border-gray-600">
      <div className="text-xs font-bold text-center border-b border-gray-600 pb-2 mb-1 flex items-center justify-center gap-1">
        <span>🔧</span> Dev Mode
      </div>
      <div className="flex gap-2">
        <button 
          onClick={setUserMode}
          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 rounded text-xs font-medium transition-colors"
        >
          User Role
        </button>
        <button 
          onClick={setAdminMode}
          className="px-3 py-1.5 bg-red-600 hover:bg-red-700 rounded text-xs font-medium transition-colors"
        >
          Admin Role
        </button>
      </div>
    </div>
  );
};

import React, { useState, useEffect } from 'react';

export const DevToolbar: React.FC = () => {
  // Only show in dev mode
  if (import.meta.env.VITE_DEV_MODE !== 'true') {
    return null;
  }

  const [isAdmin, setIsAdmin] = useState(false);
  const [showAdminPanel, setShowAdminPanel] = useState(false);

  useEffect(() => {
    const devUser = localStorage.getItem("oyuns_dev_user");
    if (devUser) {
      try {
        const parsed = JSON.parse(devUser);
        setIsAdmin(parsed.id === 1932946217);
      } catch {
        setIsAdmin(false);
      }
    }
    // Check URL for admin mode
    setShowAdminPanel(window.location.search.includes('admin=true'));
  }, []);

  const setUserMode = () => {
    localStorage.setItem("oyuns_dev_user", JSON.stringify({
      id: 123456789,
      first_name: "Dev",
      last_name: "User",
      username: "dev_user"
    }));
    // Remove admin from URL
    const url = new URL(window.location.href);
    url.searchParams.delete('admin');
    window.location.href = url.toString();
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

  const toggleAdminPanel = () => {
    const url = new URL(window.location.href);
    if (showAdminPanel) {
      url.searchParams.delete('admin');
    } else {
      url.searchParams.set('admin', 'true');
    }
    window.location.href = url.toString();
  };

  return (
    <div className="fixed bottom-4 left-4 bg-gray-800 text-white p-3 rounded-lg shadow-xl z-50 flex flex-col gap-2 border border-gray-600">
      <div className="text-xs font-bold text-center border-b border-gray-600 pb-2 mb-1 flex items-center justify-center gap-1">
        <span>🔧</span> Dev Mode
      </div>
      <div className="flex gap-2">
        <button 
          onClick={setUserMode}
          className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${!isAdmin ? 'bg-blue-600 ring-2 ring-blue-300' : 'bg-blue-600/50 hover:bg-blue-600'}`}
        >
          User Role
        </button>
        <button 
          onClick={setAdminMode}
          className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${isAdmin ? 'bg-red-600 ring-2 ring-red-300' : 'bg-red-600/50 hover:bg-red-600'}`}
        >
          Admin Role
        </button>
      </div>
      {isAdmin && (
        <button 
          onClick={toggleAdminPanel}
          className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${showAdminPanel ? 'bg-purple-600 ring-2 ring-purple-300' : 'bg-purple-600/50 hover:bg-purple-600'}`}
        >
          {showAdminPanel ? '👤 User View' : '🛡️ Admin Panel'}
        </button>
      )}
    </div>
  );
};

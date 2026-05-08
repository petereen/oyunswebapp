import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trophy, Lock, Eye, EyeOff, Users, Calendar, Settings, BarChart3, Loader2, Save, Plus, Trash2, Edit2, X } from "lucide-react";
import {
  createOyunsSagsAdminGame,
  createOyunsSagsAdminTeam,
  deleteOyunsSagsAdminGame,
  deleteOyunsSagsAdminTeam,
  fetchOyunsSagsAdminGames,
  fetchOyunsSagsAdminSettings,
  fetchOyunsSagsAdminStages,
  fetchOyunsSagsAdminTeams,
  fetchOyunsSagsAdminVotes,
  OYUNS_PLUS_LOGO_DEFAULT_URL,
  TournamentCategory,
  TournamentGame,
  TournamentGameStatus,
  TournamentGroup,
  TournamentKnockoutPhase,
  TournamentTeam,
  TournamentVenue,
  updateOyunsSagsAdminGame,
  updateOyunsSagsAdminSettings,
  updateOyunsSagsAdminStages,
  updateOyunsSagsAdminTeam,
} from "../api";

type Tab = "teams" | "games" | "votes" | "settings";

const AUTH_STORAGE_KEY = "oyuns_sags_admin_authenticated";
const KEY_STORAGE = "oyuns_sags_admin_key";

type TeamFormState = {
  name: string;
  short_name: string;
  category: TournamentCategory;
  logo_url: string;
  is_active: boolean;
  display_order: number;
};

type GameFormState = {
  category: TournamentCategory;
  venue: TournamentVenue;
  home_team_id: string;
  away_team_id: string;
  starts_at: string;
  status: TournamentGameStatus;
  home_score: number;
  away_score: number;
  is_featured: boolean;
};

type GroupFormState = {
  id?: string;
  category: TournamentCategory;
  name: string;
  team_ids: string[];
  display_order: number;
};

type KnockoutMatchFormState = {
  id: string;
  round_key: string;
  title: string;
  home_team_id: string;
  away_team_id: string;
  home_label: string;
  away_label: string;
  home_score: number;
  away_score: number;
  status: TournamentGameStatus;
};

type KnockoutPhaseFormState = {
  category: TournamentCategory;
  team_count: 4 | 8;
  matches: KnockoutMatchFormState[];
};

const TEAM_FORM_DEFAULT: TeamFormState = {
  name: "",
  short_name: "",
  category: "men",
  logo_url: "",
  is_active: true,
  display_order: 0,
};

const GAME_FORM_DEFAULT: GameFormState = {
  category: "men",
  venue: "a_hall",
  home_team_id: "",
  away_team_id: "",
  starts_at: "",
  status: "scheduled",
  home_score: 0,
  away_score: 0,
  is_featured: false,
};

const GROUP_FORM_DEFAULT: GroupFormState = {
  category: "men",
  name: "",
  team_ids: [],
  display_order: 0,
};

const TOURNAMENT_CATEGORY_OPTIONS: TournamentCategory[] = ["men", "women"];

const KNOCKOUT_ROUND_ORDER: Record<string, number> = {
  quarterfinals: 1,
  semifinals: 2,
  final: 3,
};

const KNOCKOUT_TEMPLATES: Record<4 | 8, Array<{ id: string; round_key: string; title: string; home_label: string; away_label: string }>> = {
  4: [
    { id: "semifinal-1", round_key: "semifinals", title: "Semifinal 1", home_label: "Seed 1", away_label: "Seed 4" },
    { id: "semifinal-2", round_key: "semifinals", title: "Semifinal 2", home_label: "Seed 2", away_label: "Seed 3" },
    { id: "final", round_key: "final", title: "Final", home_label: "Winner SF1", away_label: "Winner SF2" },
  ],
  8: [
    { id: "quarterfinal-1", round_key: "quarterfinals", title: "Quarterfinal 1", home_label: "Seed 1", away_label: "Seed 8" },
    { id: "quarterfinal-2", round_key: "quarterfinals", title: "Quarterfinal 2", home_label: "Seed 4", away_label: "Seed 5" },
    { id: "quarterfinal-3", round_key: "quarterfinals", title: "Quarterfinal 3", home_label: "Seed 2", away_label: "Seed 7" },
    { id: "quarterfinal-4", round_key: "quarterfinals", title: "Quarterfinal 4", home_label: "Seed 3", away_label: "Seed 6" },
    { id: "semifinal-1", round_key: "semifinals", title: "Semifinal 1", home_label: "Winner QF1", away_label: "Winner QF2" },
    { id: "semifinal-2", round_key: "semifinals", title: "Semifinal 2", home_label: "Winner QF3", away_label: "Winner QF4" },
    { id: "final", round_key: "final", title: "Final", home_label: "Winner SF1", away_label: "Winner SF2" },
  ],
};

function createGroupDraftId() {
  return `group-${Math.random().toString(36).slice(2, 10)}`;
}

function getAdminRoundLabel(roundKey: string) {
  if (roundKey === "quarterfinals") return "Quarterfinals";
  if (roundKey === "semifinals") return "Semifinals";
  return "Final";
}

function buildKnockoutPhaseForm(
  category: TournamentCategory,
  teamCount: 4 | 8,
  source?: TournamentKnockoutPhase | KnockoutPhaseFormState,
): KnockoutPhaseFormState {
  const matchMap = new Map((source?.matches || []).map((match) => [match.id, match]));

  return {
    category,
    team_count: teamCount,
    matches: KNOCKOUT_TEMPLATES[teamCount].map((template) => {
      const current = matchMap.get(template.id);
      return {
        id: template.id,
        round_key: template.round_key,
        title: current?.title || template.title,
        home_team_id: current?.home_team_id || "",
        away_team_id: current?.away_team_id || "",
        home_label: current?.home_label || template.home_label,
        away_label: current?.away_label || template.away_label,
        home_score: current?.home_score || 0,
        away_score: current?.away_score || 0,
        status: current?.status || "scheduled",
      };
    }),
  };
}

export function OyunsSagsAdminPanel() {
  const queryClient = useQueryClient();

  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<Tab>("teams");

  const [newTeam, setNewTeam] = useState<TeamFormState>(TEAM_FORM_DEFAULT);
  const [editingTeamId, setEditingTeamId] = useState<string | null>(null);
  const [editingTeam, setEditingTeam] = useState<TeamFormState>(TEAM_FORM_DEFAULT);

  const [newGame, setNewGame] = useState<GameFormState>(GAME_FORM_DEFAULT);
  const [editingGameId, setEditingGameId] = useState<string | null>(null);
  const [editingGame, setEditingGame] = useState<GameFormState>(GAME_FORM_DEFAULT);
  const [groupDrafts, setGroupDrafts] = useState<GroupFormState[]>([]);
  const [newGroup, setNewGroup] = useState<GroupFormState>(GROUP_FORM_DEFAULT);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editingGroup, setEditingGroup] = useState<GroupFormState>(GROUP_FORM_DEFAULT);
  const [knockoutDrafts, setKnockoutDrafts] = useState<Record<TournamentCategory, KnockoutPhaseFormState>>({
    men: buildKnockoutPhaseForm("men", 4),
    women: buildKnockoutPhaseForm("women", 4),
  });
  const [stageFeedback, setStageFeedback] = useState("");

  const [settingsForm, setSettingsForm] = useState({
    oyuns_tournament_enabled: 1,
    oyuns_plus_logo_url: OYUNS_PLUS_LOGO_DEFAULT_URL,
  });

  const teamsQuery = useQuery({
    queryKey: ["oyuns-sags-admin-teams"],
    queryFn: () => fetchOyunsSagsAdminTeams({ include_inactive: true }),
    enabled: isAuthenticated,
  });

  const gamesQuery = useQuery({
    queryKey: ["oyuns-sags-admin-games"],
    queryFn: () => fetchOyunsSagsAdminGames(),
    enabled: isAuthenticated,
  });

  const stagesQuery = useQuery({
    queryKey: ["oyuns-sags-admin-stages"],
    queryFn: fetchOyunsSagsAdminStages,
    enabled: isAuthenticated,
  });

  const votesQuery = useQuery({
    queryKey: ["oyuns-sags-admin-votes"],
    queryFn: fetchOyunsSagsAdminVotes,
    enabled: isAuthenticated,
  });

  const settingsQuery = useQuery({
    queryKey: ["oyuns-sags-admin-settings"],
    queryFn: fetchOyunsSagsAdminSettings,
    enabled: isAuthenticated,
  });

  useEffect(() => {
    if (settingsQuery.data) {
      setSettingsForm(settingsQuery.data);
    }
  }, [settingsQuery.data]);

  useEffect(() => {
    if (!stagesQuery.data) return;

    setGroupDrafts(
      stagesQuery.data.groups.map((group) => ({
        id: group.id,
        category: group.category,
        name: group.name,
        team_ids: [...group.team_ids],
        display_order: group.display_order,
      })),
    );

    const stageKnockoutMap = stagesQuery.data.knockout.reduce<Partial<Record<TournamentCategory, KnockoutPhaseFormState>>>((acc, phase) => {
      acc[phase.category] = buildKnockoutPhaseForm(phase.category, phase.team_count, phase);
      return acc;
    }, {});

    setKnockoutDrafts({
      men: stageKnockoutMap.men || buildKnockoutPhaseForm("men", 4),
      women: stageKnockoutMap.women || buildKnockoutPhaseForm("women", 4),
    });
  }, [stagesQuery.data]);

  const verifySession = async () => {
    try {
      await fetchOyunsSagsAdminSettings();
      setIsAuthenticated(true);
      localStorage.setItem(AUTH_STORAGE_KEY, "true");
      setError("");
      return true;
    } catch {
      setIsAuthenticated(false);
      localStorage.removeItem(AUTH_STORAGE_KEY);
      localStorage.removeItem(KEY_STORAGE);
      return false;
    }
  };

  useEffect(() => {
    const run = async () => {
      const hasSession = localStorage.getItem(AUTH_STORAGE_KEY) === "true";
      const hasKey = Boolean(localStorage.getItem(KEY_STORAGE));
      if (hasSession && hasKey) {
        await verifySession();
      }
      setCheckingSession(false);
    };
    run();
  }, []);

  const createTeamMutation = useMutation({
    mutationFn: createOyunsSagsAdminTeam,
    onSuccess: async () => {
      setNewTeam(TEAM_FORM_DEFAULT);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["oyuns-sags-admin-teams"] }),
        queryClient.invalidateQueries({ queryKey: ["oyuns-sags-admin-votes"] }),
      ]);
    },
  });

  const updateTeamMutation = useMutation({
    mutationFn: ({ teamId, payload }: { teamId: string; payload: Partial<TeamFormState> }) => updateOyunsSagsAdminTeam(teamId, payload),
    onSuccess: async () => {
      setEditingTeamId(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["oyuns-sags-admin-teams"] }),
        queryClient.invalidateQueries({ queryKey: ["oyuns-sags-admin-votes"] }),
      ]);
    },
  });

  const deleteTeamMutation = useMutation({
    mutationFn: deleteOyunsSagsAdminTeam,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["oyuns-sags-admin-teams"] }),
        queryClient.invalidateQueries({ queryKey: ["oyuns-sags-admin-votes"] }),
      ]);
    },
  });

  const createGameMutation = useMutation({
    mutationFn: createOyunsSagsAdminGame,
    onSuccess: async () => {
      setNewGame(GAME_FORM_DEFAULT);
      await queryClient.invalidateQueries({ queryKey: ["oyuns-sags-admin-games"] });
    },
  });

  const updateGameMutation = useMutation({
    mutationFn: ({ gameId, payload }: { gameId: string; payload: Partial<GameFormState> }) => updateOyunsSagsAdminGame(gameId, payload),
    onSuccess: async () => {
      setEditingGameId(null);
      await queryClient.invalidateQueries({ queryKey: ["oyuns-sags-admin-games"] });
    },
  });

  const deleteGameMutation = useMutation({
    mutationFn: deleteOyunsSagsAdminGame,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["oyuns-sags-admin-games"] });
    },
  });

  const updateSettingsMutation = useMutation({
    mutationFn: updateOyunsSagsAdminSettings,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["oyuns-sags-admin-settings"] });
    },
  });

  const updateStagesMutation = useMutation({
    mutationFn: updateOyunsSagsAdminStages,
    onSuccess: async () => {
      setStageFeedback("Tournament stage setup saved");
      setEditingGroupId(null);
      await queryClient.invalidateQueries({ queryKey: ["oyuns-sags-admin-stages"] });
    },
    onError: (err: any) => {
      const detail = err?.response?.data?.detail;
      setStageFeedback(typeof detail === "string" ? detail : "Failed to save tournament stage setup");
    },
  });

  const teams = teamsQuery.data?.items || [];
  const games = gamesQuery.data?.items || [];
  const voteTeams = votesQuery.data?.items || [];

  const teamsByCategory = useMemo(() => ({
    men: teams.filter((team) => team.category === "men"),
    women: teams.filter((team) => team.category === "women"),
  }), [teams]);

  const activeTeamsByCategory = useMemo(() => ({
    men: teams.filter((team) => team.category === "men" && team.is_active),
    women: teams.filter((team) => team.category === "women" && team.is_active),
  }), [teams]);

  const sortedGroupDrafts = useMemo(
    () => [...groupDrafts].sort((a, b) => a.category.localeCompare(b.category) || a.display_order - b.display_order || a.name.localeCompare(b.name)),
    [groupDrafts],
  );

  const availableTeamsForNewGame = teams.filter((team) => team.category === newGame.category && team.is_active);
  const availableTeamsForEditingGame = teams.filter((team) => team.category === editingGame.category && team.is_active);

  const handleLogin = async () => {
    const key = apiKey.trim();
    if (!key) {
      setError("Enter admin key");
      return;
    }
    localStorage.setItem(KEY_STORAGE, key);
    const ok = await verifySession();
    if (!ok) {
      setError("Invalid admin key");
      return;
    }
    setApiKey("");
  };

  const handleLogout = () => {
    setIsAuthenticated(false);
    localStorage.removeItem(AUTH_STORAGE_KEY);
    localStorage.removeItem(KEY_STORAGE);
    setApiKey("");
    setError("");
  };

  const startEditTeam = (team: TournamentTeam) => {
    setEditingTeamId(team.id);
    setEditingTeam({
      name: team.name,
      short_name: team.short_name || "",
      category: team.category,
      logo_url: team.logo_url || "",
      is_active: team.is_active,
      display_order: team.display_order,
    });
  };

  const startEditGame = (game: TournamentGame) => {
    const startsAtLocal = new Date(game.starts_at);
    const isoLocal = Number.isNaN(startsAtLocal.getTime())
      ? ""
      : new Date(startsAtLocal.getTime() - startsAtLocal.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

    setEditingGameId(game.id);
    setEditingGame({
      category: game.category,
      venue: game.venue,
      home_team_id: game.home_team_id,
      away_team_id: game.away_team_id,
      starts_at: isoLocal,
      status: game.status,
      home_score: game.home_score,
      away_score: game.away_score,
      is_featured: game.is_featured,
    });
  };

  const normalizeStartsAt = (value: string) => {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toISOString();
  };

  const renderGroupTeamSelector = (
    category: TournamentCategory,
    selectedTeamIds: string[],
    onToggle: (teamId: string) => void,
  ) => {
    const categoryTeams = teamsByCategory[category];
    if (categoryTeams.length === 0) {
      return <div className="text-xs text-dark-500 dark:text-ivory-400">No teams available in this category yet.</div>;
    }

    return (
      <div className="flex flex-wrap gap-2">
        {categoryTeams.map((team) => {
          const selected = selectedTeamIds.includes(team.id);
          return (
            <button
              key={team.id}
              type="button"
              onClick={() => onToggle(team.id)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition ${
                selected
                  ? "bg-sky-600 text-white"
                  : "bg-white dark:bg-dark-800 text-slate-700 dark:text-ivory-300 border border-silver/60 dark:border-dark-600"
              }`}
            >
              {team.name}
              {!team.is_active ? " (inactive)" : ""}
            </button>
          );
        })}
      </div>
    );
  };

  const toggleGroupTeam = (teamIds: string[], teamId: string) => (
    teamIds.includes(teamId)
      ? teamIds.filter((currentId) => currentId !== teamId)
      : [...teamIds, teamId]
  );

  const startEditGroup = (group: GroupFormState | TournamentGroup) => {
    setEditingGroupId(group.id);
    setEditingGroup({
      id: group.id,
      category: group.category,
      name: group.name,
      team_ids: [...group.team_ids],
      display_order: group.display_order,
    });
  };

  const addGroupDraft = () => {
    if (!newGroup.name.trim()) return;
    setGroupDrafts((current) => [
      ...current,
      {
        id: createGroupDraftId(),
        category: newGroup.category,
        name: newGroup.name.trim(),
        team_ids: Array.from(new Set(newGroup.team_ids)),
        display_order: newGroup.display_order,
      },
    ]);
    setNewGroup(GROUP_FORM_DEFAULT);
    setStageFeedback("");
  };

  const saveEditedGroup = () => {
    if (!editingGroupId || !editingGroup.name.trim()) return;
    setGroupDrafts((current) => current.map((group) => (
      group.id === editingGroupId
        ? {
            id: editingGroupId,
            category: editingGroup.category,
            name: editingGroup.name.trim(),
            team_ids: Array.from(new Set(editingGroup.team_ids)),
            display_order: editingGroup.display_order,
          }
        : group
    )));
    setEditingGroupId(null);
    setEditingGroup(GROUP_FORM_DEFAULT);
    setStageFeedback("");
  };

  const buildStagePayload = () => ({
    groups: [...groupDrafts]
      .sort((a, b) => a.category.localeCompare(b.category) || a.display_order - b.display_order || a.name.localeCompare(b.name))
      .map((group) => ({
        id: group.id,
        category: group.category,
        name: group.name.trim(),
        team_ids: Array.from(new Set(group.team_ids)),
        display_order: group.display_order,
      })),
    knockout: TOURNAMENT_CATEGORY_OPTIONS.map((category) => {
      const phase = knockoutDrafts[category];
      return {
        category,
        team_count: phase.team_count,
        matches: phase.matches.map((match) => ({
          id: match.id,
          round_key: match.round_key,
          title: match.title.trim() || match.title,
          home_team_id: match.home_team_id || null,
          away_team_id: match.away_team_id || null,
          home_label: match.home_label.trim() || null,
          away_label: match.away_label.trim() || null,
          home_score: match.home_score,
          away_score: match.away_score,
          status: match.status,
        })),
      };
    }),
  });

  const saveStageSetup = () => {
    setStageFeedback("");
    updateStagesMutation.mutate(buildStagePayload());
  };

  const setKnockoutTeamCount = (category: TournamentCategory, teamCount: 4 | 8) => {
    setKnockoutDrafts((current) => ({
      ...current,
      [category]: buildKnockoutPhaseForm(category, teamCount, current[category]),
    }));
    setStageFeedback("");
  };

  const updateKnockoutMatch = (
    category: TournamentCategory,
    matchId: string,
    patch: Partial<KnockoutMatchFormState>,
  ) => {
    setKnockoutDrafts((current) => ({
      ...current,
      [category]: {
        ...current[category],
        matches: current[category].matches.map((match) => (
          match.id === matchId ? { ...match, ...patch } : match
        )),
      },
    }));
    setStageFeedback("");
  };

  if (checkingSession) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-sky-50 to-white dark:from-dark-900 dark:to-dark-800">
        <Loader2 className="w-8 h-8 text-sky-600 animate-spin" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-sky-50 to-white dark:from-dark-900 dark:to-dark-800 p-4">
        <div className="bg-white dark:bg-dark-800 rounded-2xl p-8 shadow-sm max-w-md mx-auto mt-20 border border-silver/60 dark:border-dark-600">
          <div className="text-center mb-6">
            <div className="w-16 h-16 bg-sky-100 dark:bg-sky-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
              <Lock className="w-8 h-8 text-sky-600" />
            </div>
            <h1 className="text-xl font-bold text-slate-800 dark:text-ivory-200">OYUNS SAGS Admin</h1>
            <p className="text-sm text-slate-500 dark:text-ivory-400 mt-1">Standalone API-key access (no Telegram auth)</p>
          </div>

          <div className="space-y-4">
            <div className="relative">
              <input
                type={showKey ? "text" : "password"}
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  setError("");
                }}
                onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                placeholder="Enter admin key"
                className="w-full px-4 py-3 pr-12 border border-slate-200 dark:border-dark-600 bg-white dark:bg-dark-700 text-dark-800 dark:text-ivory-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                {showKey ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>

            {error && <div className="text-red-500 text-sm text-center">{error}</div>}

            <button
              onClick={handleLogin}
              className="w-full bg-sky-600 text-white py-3 rounded-xl font-semibold hover:bg-sky-700 transition"
            >
              Sign in
            </button>
          </div>
        </div>
      </div>
    );
  }

  const tabs: { key: Tab; label: string; icon: typeof Trophy }[] = [
    { key: "teams", label: "Teams", icon: Users },
    { key: "games", label: "Games", icon: Calendar },
    { key: "votes", label: "Votes", icon: BarChart3 },
    { key: "settings", label: "Settings", icon: Settings },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-b from-sky-50 to-white dark:from-dark-900 dark:to-dark-800 p-4">
      <div className="max-w-6xl mx-auto space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sky-700 dark:text-sky-400 font-bold text-lg">
            <Trophy className="w-5 h-5" /> OYUNS SAGS Admin
          </div>
          <button onClick={handleLogout} className="text-sm text-slate-500 hover:text-slate-700 underline">
            Logout
          </button>
        </div>

        <div className="flex gap-2 flex-wrap">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex-1 min-w-[120px] flex items-center justify-center gap-2 py-3 rounded-xl font-semibold transition ${
                  activeTab === tab.key
                    ? "bg-sky-600 text-white"
                    : "bg-white dark:bg-dark-700 text-slate-700 dark:text-ivory-300 border border-slate-200 dark:border-dark-600 hover:bg-slate-50 dark:hover:bg-dark-600"
                }`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {activeTab === "teams" && (
          <div className="bg-white dark:bg-dark-800 rounded-2xl p-5 border border-silver/60 dark:border-dark-600 shadow-card-xs space-y-4">
            <div className="text-base font-bold text-dark-800 dark:text-ivory-200">Team Management</div>

            <div className="grid grid-cols-1 md:grid-cols-6 gap-2 p-3 rounded-xl bg-surface-50 dark:bg-dark-700">
              <input className="md:col-span-2 rounded-lg border border-silver/60 dark:border-dark-600 bg-white dark:bg-dark-800 px-3 py-2 text-sm" placeholder="Team name" value={newTeam.name} onChange={(e) => setNewTeam((s) => ({ ...s, name: e.target.value }))} />
              <input className="rounded-lg border border-silver/60 dark:border-dark-600 bg-white dark:bg-dark-800 px-3 py-2 text-sm" placeholder="Short" value={newTeam.short_name} onChange={(e) => setNewTeam((s) => ({ ...s, short_name: e.target.value }))} />
              <select className="rounded-lg border border-silver/60 dark:border-dark-600 bg-white dark:bg-dark-800 px-3 py-2 text-sm" value={newTeam.category} onChange={(e) => setNewTeam((s) => ({ ...s, category: e.target.value as TournamentCategory }))}>
                <option value="men">Men</option>
                <option value="women">Women</option>
              </select>
              <input type="number" className="rounded-lg border border-silver/60 dark:border-dark-600 bg-white dark:bg-dark-800 px-3 py-2 text-sm" placeholder="Order" value={newTeam.display_order} onChange={(e) => setNewTeam((s) => ({ ...s, display_order: Number(e.target.value || 0) }))} />
              <button
                onClick={() => createTeamMutation.mutate({ ...newTeam, logo_url: newTeam.logo_url || undefined })}
                disabled={!newTeam.name.trim() || createTeamMutation.isPending}
                className="rounded-lg bg-sky-600 text-white px-3 py-2 text-sm font-semibold hover:bg-sky-700 disabled:opacity-50"
              >
                <Plus className="w-4 h-4 inline mr-1" /> Add
              </button>
              <input className="md:col-span-6 rounded-lg border border-silver/60 dark:border-dark-600 bg-white dark:bg-dark-800 px-3 py-2 text-sm" placeholder="Logo URL (optional)" value={newTeam.logo_url} onChange={(e) => setNewTeam((s) => ({ ...s, logo_url: e.target.value }))} />
            </div>

            <div className="space-y-2">
              {teamsQuery.isLoading ? (
                <div className="text-sm text-dark-600 dark:text-ivory-400">Loading teams...</div>
              ) : (
                teams.map((team) => (
                  <div key={team.id} className="rounded-xl border border-silver/60 dark:border-dark-600 p-3 bg-surface-50 dark:bg-dark-700">
                    {editingTeamId === team.id ? (
                      <div className="grid grid-cols-1 md:grid-cols-6 gap-2">
                        <input className="md:col-span-2 rounded-lg border border-silver/60 dark:border-dark-600 bg-white dark:bg-dark-800 px-3 py-2 text-sm" value={editingTeam.name} onChange={(e) => setEditingTeam((s) => ({ ...s, name: e.target.value }))} />
                        <input className="rounded-lg border border-silver/60 dark:border-dark-600 bg-white dark:bg-dark-800 px-3 py-2 text-sm" value={editingTeam.short_name} onChange={(e) => setEditingTeam((s) => ({ ...s, short_name: e.target.value }))} />
                        <select className="rounded-lg border border-silver/60 dark:border-dark-600 bg-white dark:bg-dark-800 px-3 py-2 text-sm" value={editingTeam.category} onChange={(e) => setEditingTeam((s) => ({ ...s, category: e.target.value as TournamentCategory }))}>
                          <option value="men">Men</option>
                          <option value="women">Women</option>
                        </select>
                        <input type="number" className="rounded-lg border border-silver/60 dark:border-dark-600 bg-white dark:bg-dark-800 px-3 py-2 text-sm" value={editingTeam.display_order} onChange={(e) => setEditingTeam((s) => ({ ...s, display_order: Number(e.target.value || 0) }))} />
                        <div className="flex gap-2">
                          <button onClick={() => updateTeamMutation.mutate({ teamId: team.id, payload: { ...editingTeam } })} className="flex-1 rounded-lg bg-emerald-600 text-white px-2 py-2 text-sm font-semibold hover:bg-emerald-700"><Save className="w-4 h-4 inline mr-1" />Save</button>
                          <button onClick={() => setEditingTeamId(null)} className="flex-1 rounded-lg bg-slate-200 text-slate-800 px-2 py-2 text-sm font-semibold hover:bg-slate-300"><X className="w-4 h-4 inline mr-1" />Cancel</button>
                        </div>
                        <input className="md:col-span-6 rounded-lg border border-silver/60 dark:border-dark-600 bg-white dark:bg-dark-800 px-3 py-2 text-sm" value={editingTeam.logo_url} onChange={(e) => setEditingTeam((s) => ({ ...s, logo_url: e.target.value }))} placeholder="Logo URL" />
                      </div>
                    ) : (
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-semibold text-sm text-dark-800 dark:text-ivory-200 truncate">{team.name} {team.short_name ? `(${team.short_name})` : ""}</div>
                          <div className="text-xs text-dark-600 dark:text-ivory-400">{team.category} • votes: {team.votes_count} • order: {team.display_order} • {team.is_active ? "active" : "inactive"}</div>
                        </div>
                        <div className="flex gap-2">
                          <button onClick={() => startEditTeam(team)} className="px-2.5 py-1.5 rounded-lg bg-sky-100 text-sky-700 text-xs font-semibold hover:bg-sky-200"><Edit2 className="w-3.5 h-3.5 inline mr-1" />Edit</button>
                          <button onClick={() => deleteTeamMutation.mutate(team.id)} className="px-2.5 py-1.5 rounded-lg bg-rose-100 text-rose-700 text-xs font-semibold hover:bg-rose-200"><Trash2 className="w-3.5 h-3.5 inline mr-1" />Deactivate</button>
                        </div>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {activeTab === "games" && (
          <div className="bg-white dark:bg-dark-800 rounded-2xl p-5 border border-silver/60 dark:border-dark-600 shadow-card-xs space-y-4">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <div className="text-base font-bold text-dark-800 dark:text-ivory-200">Game Schedule & Scores</div>
                <div className="text-sm text-dark-600 dark:text-ivory-400">Manage groups, knockout brackets, and the match list shown in the mini app Games tab.</div>
              </div>

              <button
                onClick={saveStageSetup}
                disabled={updateStagesMutation.isPending || stagesQuery.isLoading}
                className="rounded-lg bg-sky-600 text-white px-4 py-2 text-sm font-semibold hover:bg-sky-700 disabled:opacity-50"
              >
                <Save className="w-4 h-4 inline mr-1" /> Save stage setup
              </button>
            </div>

            {stageFeedback && (
              <div className={`text-sm rounded-xl px-3 py-2 border ${
                updateStagesMutation.isError
                  ? "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/20 dark:text-rose-300 dark:border-rose-900/40"
                  : "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/20 dark:text-emerald-300 dark:border-emerald-900/40"
              }`}>
                {stageFeedback}
              </div>
            )}

            {stagesQuery.isLoading ? (
              <div className="text-sm text-dark-600 dark:text-ivory-400">Loading stage configuration...</div>
            ) : (
              <>
                <div className="rounded-2xl border border-silver/60 dark:border-dark-600 p-4 bg-surface-50 dark:bg-dark-700 space-y-4">
                  <div>
                    <div className="text-sm font-bold text-dark-800 dark:text-ivory-200">Group Stage</div>
                    <div className="text-xs text-dark-500 dark:text-ivory-400">Assign teams to groups that appear above the schedule in the mini app.</div>
                  </div>

                  <div className="rounded-xl border border-silver/60 dark:border-dark-600 bg-white dark:bg-dark-800 p-3 space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                      <input
                        className="rounded-lg border border-silver/60 dark:border-dark-600 bg-white dark:bg-dark-800 px-3 py-2 text-sm"
                        placeholder="Group name"
                        value={newGroup.name}
                        onChange={(e) => setNewGroup((current) => ({ ...current, name: e.target.value }))}
                      />
                      <select
                        className="rounded-lg border border-silver/60 dark:border-dark-600 bg-white dark:bg-dark-800 px-3 py-2 text-sm"
                        value={newGroup.category}
                        onChange={(e) => setNewGroup((current) => ({ ...current, category: e.target.value as TournamentCategory, team_ids: [] }))}
                      >
                        <option value="men">Men</option>
                        <option value="women">Women</option>
                      </select>
                      <input
                        type="number"
                        className="rounded-lg border border-silver/60 dark:border-dark-600 bg-white dark:bg-dark-800 px-3 py-2 text-sm"
                        placeholder="Order"
                        value={newGroup.display_order}
                        onChange={(e) => setNewGroup((current) => ({ ...current, display_order: Number(e.target.value || 0) }))}
                      />
                      <button
                        onClick={addGroupDraft}
                        disabled={!newGroup.name.trim()}
                        className="rounded-lg bg-sky-600 text-white px-3 py-2 text-sm font-semibold hover:bg-sky-700 disabled:opacity-50"
                      >
                        <Plus className="w-4 h-4 inline mr-1" /> Add group
                      </button>
                    </div>

                    {renderGroupTeamSelector(
                      newGroup.category,
                      newGroup.team_ids,
                      (teamId) => setNewGroup((current) => ({ ...current, team_ids: toggleGroupTeam(current.team_ids, teamId) })),
                    )}
                  </div>

                  <div className="space-y-2">
                    {sortedGroupDrafts.length === 0 ? (
                      <div className="text-sm text-dark-600 dark:text-ivory-400">No groups configured yet.</div>
                    ) : (
                      sortedGroupDrafts.map((group) => (
                        <div key={group.id} className="rounded-xl border border-silver/60 dark:border-dark-600 bg-white dark:bg-dark-800 p-3">
                          {editingGroupId === group.id ? (
                            <div className="space-y-3">
                              <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                                <input
                                  className="rounded-lg border border-silver/60 dark:border-dark-600 bg-white dark:bg-dark-800 px-3 py-2 text-sm"
                                  value={editingGroup.name}
                                  onChange={(e) => setEditingGroup((current) => ({ ...current, name: e.target.value }))}
                                />
                                <select
                                  className="rounded-lg border border-silver/60 dark:border-dark-600 bg-white dark:bg-dark-800 px-3 py-2 text-sm"
                                  value={editingGroup.category}
                                  onChange={(e) => setEditingGroup((current) => ({ ...current, category: e.target.value as TournamentCategory, team_ids: [] }))}
                                >
                                  <option value="men">Men</option>
                                  <option value="women">Women</option>
                                </select>
                                <input
                                  type="number"
                                  className="rounded-lg border border-silver/60 dark:border-dark-600 bg-white dark:bg-dark-800 px-3 py-2 text-sm"
                                  value={editingGroup.display_order}
                                  onChange={(e) => setEditingGroup((current) => ({ ...current, display_order: Number(e.target.value || 0) }))}
                                />
                                <div className="flex gap-2">
                                  <button onClick={saveEditedGroup} className="flex-1 rounded-lg bg-emerald-600 text-white px-3 py-2 text-sm font-semibold hover:bg-emerald-700"><Save className="w-4 h-4 inline mr-1" />Apply</button>
                                  <button onClick={() => setEditingGroupId(null)} className="flex-1 rounded-lg bg-slate-200 text-slate-800 px-3 py-2 text-sm font-semibold hover:bg-slate-300"><X className="w-4 h-4 inline mr-1" />Cancel</button>
                                </div>
                              </div>

                              {renderGroupTeamSelector(
                                editingGroup.category,
                                editingGroup.team_ids,
                                (teamId) => setEditingGroup((current) => ({ ...current, team_ids: toggleGroupTeam(current.team_ids, teamId) })),
                              )}
                            </div>
                          ) : (
                            <div className="flex items-center justify-between gap-3 flex-wrap">
                              <div className="min-w-0">
                                <div className="font-semibold text-sm text-dark-800 dark:text-ivory-200 truncate">{group.name}</div>
                                <div className="text-xs text-dark-600 dark:text-ivory-400">{group.category} • order: {group.display_order} • teams: {group.team_ids.length}</div>
                              </div>

                              <div className="flex gap-2">
                                <button onClick={() => startEditGroup(group)} className="px-2.5 py-1.5 rounded-lg bg-sky-100 text-sky-700 text-xs font-semibold hover:bg-sky-200"><Edit2 className="w-3.5 h-3.5 inline mr-1" />Edit</button>
                                <button
                                  onClick={() => {
                                    setGroupDrafts((current) => current.filter((item) => item.id !== group.id));
                                    setStageFeedback("");
                                  }}
                                  className="px-2.5 py-1.5 rounded-lg bg-rose-100 text-rose-700 text-xs font-semibold hover:bg-rose-200"
                                >
                                  <Trash2 className="w-3.5 h-3.5 inline mr-1" />Remove
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className="rounded-2xl border border-silver/60 dark:border-dark-600 p-4 bg-surface-50 dark:bg-dark-700 space-y-4">
                  <div>
                    <div className="text-sm font-bold text-dark-800 dark:text-ivory-200">Knockout Phase</div>
                    <div className="text-xs text-dark-500 dark:text-ivory-400">Choose a 4-team or 8-team bracket for each category and edit the matches below.</div>
                  </div>

                  {TOURNAMENT_CATEGORY_OPTIONS.map((category) => {
                    const phase = knockoutDrafts[category];
                    const rounds = Array.from(
                      phase.matches.reduce((map, match) => {
                        const bucket = map.get(match.round_key) || [];
                        bucket.push(match);
                        map.set(match.round_key, bucket);
                        return map;
                      }, new Map<string, KnockoutMatchFormState[]>()),
                    ).sort((a, b) => (KNOCKOUT_ROUND_ORDER[a[0]] || 99) - (KNOCKOUT_ROUND_ORDER[b[0]] || 99));

                    return (
                      <div key={category} className="rounded-xl border border-silver/60 dark:border-dark-600 bg-white dark:bg-dark-800 p-4 space-y-4">
                        <div className="flex items-center justify-between gap-3 flex-wrap">
                          <div>
                            <div className="text-sm font-bold text-dark-800 dark:text-ivory-200">{category === "men" ? "Men" : "Women"}</div>
                            <div className="text-xs text-dark-500 dark:text-ivory-400">{phase.team_count} teams in bracket</div>
                          </div>

                          <select
                            className="rounded-lg border border-silver/60 dark:border-dark-600 bg-white dark:bg-dark-800 px-3 py-2 text-sm"
                            value={phase.team_count}
                            onChange={(e) => setKnockoutTeamCount(category, Number(e.target.value) as 4 | 8)}
                          >
                            <option value={4}>4 teams</option>
                            <option value={8}>8 teams</option>
                          </select>
                        </div>

                        <div className={`grid gap-3 ${rounds.length >= 3 ? "xl:grid-cols-3" : rounds.length === 2 ? "md:grid-cols-2" : "grid-cols-1"}`}>
                          {rounds.map(([roundKey, matches]) => (
                            <div key={roundKey} className="rounded-xl border border-silver/60 dark:border-dark-600 bg-surface-50 dark:bg-dark-700 p-3 space-y-3">
                              <div className="text-xs font-bold uppercase tracking-[0.14em] text-dark-500 dark:text-ivory-400">{getAdminRoundLabel(roundKey)}</div>

                              {matches.map((match) => (
                                <div key={match.id} className="rounded-xl border border-silver/60 dark:border-dark-600 bg-white dark:bg-dark-800 p-3 space-y-2">
                                  <input
                                    className="w-full rounded-lg border border-silver/60 dark:border-dark-600 bg-white dark:bg-dark-800 px-3 py-2 text-sm"
                                    value={match.title}
                                    onChange={(e) => updateKnockoutMatch(category, match.id, { title: e.target.value })}
                                  />

                                  <div className="grid grid-cols-1 gap-2">
                                    <select
                                      className="rounded-lg border border-silver/60 dark:border-dark-600 bg-white dark:bg-dark-800 px-3 py-2 text-sm"
                                      value={match.home_team_id}
                                      onChange={(e) => updateKnockoutMatch(category, match.id, { home_team_id: e.target.value })}
                                    >
                                      <option value="">Home team</option>
                                      {activeTeamsByCategory[category].map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
                                    </select>
                                    <select
                                      className="rounded-lg border border-silver/60 dark:border-dark-600 bg-white dark:bg-dark-800 px-3 py-2 text-sm"
                                      value={match.away_team_id}
                                      onChange={(e) => updateKnockoutMatch(category, match.id, { away_team_id: e.target.value })}
                                    >
                                      <option value="">Away team</option>
                                      {activeTeamsByCategory[category].map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
                                    </select>
                                  </div>

                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                    <input
                                      className="rounded-lg border border-silver/60 dark:border-dark-600 bg-white dark:bg-dark-800 px-3 py-2 text-sm"
                                      placeholder="Home label"
                                      value={match.home_label}
                                      onChange={(e) => updateKnockoutMatch(category, match.id, { home_label: e.target.value })}
                                    />
                                    <input
                                      className="rounded-lg border border-silver/60 dark:border-dark-600 bg-white dark:bg-dark-800 px-3 py-2 text-sm"
                                      placeholder="Away label"
                                      value={match.away_label}
                                      onChange={(e) => updateKnockoutMatch(category, match.id, { away_label: e.target.value })}
                                    />
                                  </div>

                                  <div className="grid grid-cols-3 gap-2">
                                    <input
                                      type="number"
                                      min={0}
                                      className="rounded-lg border border-silver/60 dark:border-dark-600 bg-white dark:bg-dark-800 px-3 py-2 text-sm"
                                      value={match.home_score}
                                      onChange={(e) => updateKnockoutMatch(category, match.id, { home_score: Number(e.target.value || 0) })}
                                    />
                                    <input
                                      type="number"
                                      min={0}
                                      className="rounded-lg border border-silver/60 dark:border-dark-600 bg-white dark:bg-dark-800 px-3 py-2 text-sm"
                                      value={match.away_score}
                                      onChange={(e) => updateKnockoutMatch(category, match.id, { away_score: Number(e.target.value || 0) })}
                                    />
                                    <select
                                      className="rounded-lg border border-silver/60 dark:border-dark-600 bg-white dark:bg-dark-800 px-3 py-2 text-sm"
                                      value={match.status}
                                      onChange={(e) => updateKnockoutMatch(category, match.id, { status: e.target.value as TournamentGameStatus })}
                                    >
                                      <option value="scheduled">Scheduled</option>
                                      <option value="live">Live</option>
                                      <option value="completed">Completed</option>
                                      <option value="cancelled">Cancelled</option>
                                    </select>
                                  </div>
                                </div>
                              ))}
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            <div className="text-sm font-bold text-dark-800 dark:text-ivory-200">Match Schedule</div>

            <div className="grid grid-cols-1 md:grid-cols-7 gap-2 p-3 rounded-xl bg-surface-50 dark:bg-dark-700">
              <select className="rounded-lg border border-silver/60 dark:border-dark-600 bg-white dark:bg-dark-800 px-3 py-2 text-sm" value={newGame.category} onChange={(e) => setNewGame((s) => ({ ...s, category: e.target.value as TournamentCategory, home_team_id: "", away_team_id: "" }))}>
                <option value="men">Men</option>
                <option value="women">Women</option>
              </select>
              <select className="rounded-lg border border-silver/60 dark:border-dark-600 bg-white dark:bg-dark-800 px-3 py-2 text-sm" value={newGame.venue} onChange={(e) => setNewGame((s) => ({ ...s, venue: e.target.value as TournamentVenue }))}>
                <option value="a_hall">A Hall</option>
                <option value="b_hall">B Hall</option>
              </select>
              <select className="rounded-lg border border-silver/60 dark:border-dark-600 bg-white dark:bg-dark-800 px-3 py-2 text-sm" value={newGame.home_team_id} onChange={(e) => setNewGame((s) => ({ ...s, home_team_id: e.target.value }))}>
                <option value="">Home team</option>
                {availableTeamsForNewGame.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
              </select>
              <select className="rounded-lg border border-silver/60 dark:border-dark-600 bg-white dark:bg-dark-800 px-3 py-2 text-sm" value={newGame.away_team_id} onChange={(e) => setNewGame((s) => ({ ...s, away_team_id: e.target.value }))}>
                <option value="">Away team</option>
                {availableTeamsForNewGame.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
              </select>
              <input type="datetime-local" className="rounded-lg border border-silver/60 dark:border-dark-600 bg-white dark:bg-dark-800 px-3 py-2 text-sm" value={newGame.starts_at} onChange={(e) => setNewGame((s) => ({ ...s, starts_at: e.target.value }))} />
              <select className="rounded-lg border border-silver/60 dark:border-dark-600 bg-white dark:bg-dark-800 px-3 py-2 text-sm" value={newGame.status} onChange={(e) => setNewGame((s) => ({ ...s, status: e.target.value as TournamentGameStatus }))}>
                <option value="scheduled">Scheduled</option>
                <option value="live">Live</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
              </select>
              <button
                onClick={() => createGameMutation.mutate({ ...newGame, starts_at: normalizeStartsAt(newGame.starts_at) })}
                disabled={!newGame.home_team_id || !newGame.away_team_id || !newGame.starts_at || createGameMutation.isPending}
                className="rounded-lg bg-sky-600 text-white px-3 py-2 text-sm font-semibold hover:bg-sky-700 disabled:opacity-50"
              >
                <Plus className="w-4 h-4 inline mr-1" /> Add
              </button>
            </div>

            <div className="space-y-2">
              {gamesQuery.isLoading ? (
                <div className="text-sm text-dark-600 dark:text-ivory-400">Loading games...</div>
              ) : (
                games.map((game) => (
                  <div key={game.id} className="rounded-xl border border-silver/60 dark:border-dark-600 p-3 bg-surface-50 dark:bg-dark-700">
                    {editingGameId === game.id ? (
                      <div className="grid grid-cols-1 md:grid-cols-8 gap-2">
                        <select className="rounded-lg border border-silver/60 dark:border-dark-600 bg-white dark:bg-dark-800 px-3 py-2 text-sm" value={editingGame.category} onChange={(e) => setEditingGame((s) => ({ ...s, category: e.target.value as TournamentCategory, home_team_id: "", away_team_id: "" }))}>
                          <option value="men">Men</option>
                          <option value="women">Women</option>
                        </select>
                        <select className="rounded-lg border border-silver/60 dark:border-dark-600 bg-white dark:bg-dark-800 px-3 py-2 text-sm" value={editingGame.venue} onChange={(e) => setEditingGame((s) => ({ ...s, venue: e.target.value as TournamentVenue }))}>
                          <option value="a_hall">A Hall</option>
                          <option value="b_hall">B Hall</option>
                        </select>
                        <select className="rounded-lg border border-silver/60 dark:border-dark-600 bg-white dark:bg-dark-800 px-3 py-2 text-sm" value={editingGame.home_team_id} onChange={(e) => setEditingGame((s) => ({ ...s, home_team_id: e.target.value }))}>
                          <option value="">Home</option>
                          {availableTeamsForEditingGame.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
                        </select>
                        <select className="rounded-lg border border-silver/60 dark:border-dark-600 bg-white dark:bg-dark-800 px-3 py-2 text-sm" value={editingGame.away_team_id} onChange={(e) => setEditingGame((s) => ({ ...s, away_team_id: e.target.value }))}>
                          <option value="">Away</option>
                          {availableTeamsForEditingGame.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
                        </select>
                        <input type="datetime-local" className="rounded-lg border border-silver/60 dark:border-dark-600 bg-white dark:bg-dark-800 px-3 py-2 text-sm" value={editingGame.starts_at} onChange={(e) => setEditingGame((s) => ({ ...s, starts_at: e.target.value }))} />
                        <select className="rounded-lg border border-silver/60 dark:border-dark-600 bg-white dark:bg-dark-800 px-3 py-2 text-sm" value={editingGame.status} onChange={(e) => setEditingGame((s) => ({ ...s, status: e.target.value as TournamentGameStatus }))}>
                          <option value="scheduled">Scheduled</option>
                          <option value="live">Live</option>
                          <option value="completed">Completed</option>
                          <option value="cancelled">Cancelled</option>
                        </select>
                        <div className="flex gap-2">
                          <input type="number" min={0} className="w-14 rounded-lg border border-silver/60 dark:border-dark-600 bg-white dark:bg-dark-800 px-2 py-2 text-sm" value={editingGame.home_score} onChange={(e) => setEditingGame((s) => ({ ...s, home_score: Number(e.target.value || 0) }))} />
                          <input type="number" min={0} className="w-14 rounded-lg border border-silver/60 dark:border-dark-600 bg-white dark:bg-dark-800 px-2 py-2 text-sm" value={editingGame.away_score} onChange={(e) => setEditingGame((s) => ({ ...s, away_score: Number(e.target.value || 0) }))} />
                        </div>
                        <div className="flex gap-2">
                          <button onClick={() => updateGameMutation.mutate({ gameId: game.id, payload: { ...editingGame, starts_at: normalizeStartsAt(editingGame.starts_at) } })} className="flex-1 rounded-lg bg-emerald-600 text-white px-2 py-2 text-sm font-semibold hover:bg-emerald-700"><Save className="w-4 h-4 inline mr-1" />Save</button>
                          <button onClick={() => setEditingGameId(null)} className="flex-1 rounded-lg bg-slate-200 text-slate-800 px-2 py-2 text-sm font-semibold hover:bg-slate-300"><X className="w-4 h-4 inline mr-1" />Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-semibold text-sm text-dark-800 dark:text-ivory-200 truncate">{game.home_team_name || game.home_team_id} vs {game.away_team_name || game.away_team_id}</div>
                          <div className="text-xs text-dark-600 dark:text-ivory-400">{game.category} • {game.venue} • {game.status} • {new Date(game.starts_at).toLocaleString()} • {game.home_score}:{game.away_score}</div>
                        </div>
                        <div className="flex gap-2">
                          <button onClick={() => startEditGame(game)} className="px-2.5 py-1.5 rounded-lg bg-sky-100 text-sky-700 text-xs font-semibold hover:bg-sky-200"><Edit2 className="w-3.5 h-3.5 inline mr-1" />Edit</button>
                          <button onClick={() => deleteGameMutation.mutate(game.id)} className="px-2.5 py-1.5 rounded-lg bg-rose-100 text-rose-700 text-xs font-semibold hover:bg-rose-200"><Trash2 className="w-3.5 h-3.5 inline mr-1" />Delete</button>
                        </div>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {activeTab === "votes" && (
          <div className="bg-white dark:bg-dark-800 rounded-2xl p-5 border border-silver/60 dark:border-dark-600 shadow-card-xs space-y-3">
            <div className="text-base font-bold text-dark-800 dark:text-ivory-200">Voting Overview</div>
            <div className="text-sm text-dark-600 dark:text-ivory-400">Total votes: {votesQuery.data?.total_votes || 0}</div>
            <div className="space-y-2">
              {votesQuery.isLoading ? (
                <div className="text-sm text-dark-600 dark:text-ivory-400">Loading votes...</div>
              ) : voteTeams.length === 0 ? (
                <div className="text-sm text-dark-600 dark:text-ivory-400">No votes yet.</div>
              ) : (
                voteTeams.map((team) => (
                  <div key={team.id} className="rounded-xl border border-silver/60 dark:border-dark-600 p-3 bg-surface-50 dark:bg-dark-700 flex items-center justify-between">
                    <div className="text-sm font-semibold text-dark-800 dark:text-ivory-200">{team.name} ({team.category})</div>
                    <div className="text-sm font-bold text-maroon-700 dark:text-gold-400">{team.votes_count}</div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {activeTab === "settings" && (
          <div className="bg-white dark:bg-dark-800 rounded-2xl p-5 border border-silver/60 dark:border-dark-600 shadow-card-xs space-y-4">
            <div className="text-base font-bold text-dark-800 dark:text-ivory-200">Tournament Settings</div>
            <div className="text-sm text-dark-600 dark:text-ivory-400">This panel is independent from Telegram auth and uses X-Oyuns-Sags-Key API key only.</div>

            <label className="flex items-center gap-3 text-sm text-dark-700 dark:text-ivory-300">
              <input
                type="checkbox"
                checked={settingsForm.oyuns_tournament_enabled > 0}
                onChange={(e) => setSettingsForm((s) => ({ ...s, oyuns_tournament_enabled: e.target.checked ? 1 : 0 }))}
              />
              Tournament enabled
            </label>

            <div className="space-y-1">
              <div className="text-sm font-medium text-dark-700 dark:text-ivory-300">OYUNS Plus logo URL</div>
              <input
                type="text"
                value={settingsForm.oyuns_plus_logo_url}
                onChange={(e) => setSettingsForm((s) => ({ ...s, oyuns_plus_logo_url: e.target.value }))}
                className="w-full rounded-lg border border-silver/60 dark:border-dark-600 bg-white dark:bg-dark-700 px-3 py-2 text-sm"
              />
            </div>

            <button
              onClick={() => updateSettingsMutation.mutate(settingsForm)}
              disabled={updateSettingsMutation.isPending}
              className="rounded-lg bg-sky-600 text-white px-4 py-2 text-sm font-semibold hover:bg-sky-700 disabled:opacity-50"
            >
              <Save className="w-4 h-4 inline mr-1" /> Save settings
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

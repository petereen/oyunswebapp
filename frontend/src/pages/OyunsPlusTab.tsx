import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trophy, Calendar, MapPin, Users } from "lucide-react";
import {
  fetchOyunsPlusSummary,
  fetchTournamentMyVotes,
  fetchTournamentOverview,
  OYUNS_PLUS_LOGO_DEFAULT_URL,
  submitTournamentVote,
  TournamentCategory,
  TournamentVenue,
} from "../api";
import { useLang } from "../i18n/useLang";

interface Props {
  userId?: number;
}

export function OyunsPlusTab({ userId }: Props) {
  const { t } = useLang();
  const queryClient = useQueryClient();
  const [gameCategoryFilter, setGameCategoryFilter] = useState<"all" | TournamentCategory>("all");
  const [gameVenueFilter, setGameVenueFilter] = useState<"all" | TournamentVenue>("all");
  const [voteMessage, setVoteMessage] = useState("");
  const [activeTournamentSection, setActiveTournamentSection] = useState<"basketball" | null>(null);
  const [tournamentInnerTab, setTournamentInnerTab] = useState<"schedule" | "leaderboard">("schedule");

  const { data, isLoading } = useQuery({
    queryKey: ["oyuns-plus-summary", userId],
    queryFn: () => fetchOyunsPlusSummary(),
    enabled: Boolean(userId),
    retry: 1,
  });

  const { data: tournamentOverview, isLoading: tournamentLoading } = useQuery({
    queryKey: ["tournament-overview"],
    queryFn: () => fetchTournamentOverview(),
    retry: 1,
  });

  const { data: myVotes } = useQuery({
    queryKey: ["tournament-my-votes", userId],
    queryFn: () => fetchTournamentMyVotes(),
    enabled: Boolean(userId),
    retry: 1,
  });

  const voteByCategory = useMemo(() => {
    const map: Record<string, { voted: boolean; team_id?: string | null }> = {
      men: { voted: false },
      women: { voted: false },
    };
    for (const vote of myVotes || []) {
      map[vote.category] = { voted: vote.voted, team_id: vote.team_id };
    }
    return map;
  }, [myVotes]);

  const teams = tournamentOverview?.teams || [];
  const games = tournamentOverview?.games || [];
  const logoUrl = tournamentOverview?.logo_url || OYUNS_PLUS_LOGO_DEFAULT_URL;

  const menTeams = useMemo(
    () => teams.filter((team) => team.category === "men").sort((a, b) => b.votes_count - a.votes_count || a.display_order - b.display_order),
    [teams],
  );
  const womenTeams = useMemo(
    () => teams.filter((team) => team.category === "women").sort((a, b) => b.votes_count - a.votes_count || a.display_order - b.display_order),
    [teams],
  );

  const filteredGames = useMemo(
    () => games.filter((game) => {
      if (gameCategoryFilter !== "all" && game.category !== gameCategoryFilter) return false;
      if (gameVenueFilter !== "all" && game.venue !== gameVenueFilter) return false;
      return true;
    }),
    [games, gameCategoryFilter, gameVenueFilter],
  );

  const voteMutation = useMutation({
    mutationFn: submitTournamentVote,
    onSuccess: async (res) => {
      setVoteMessage(res.message || t("oyuns_plus.vote_success"));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["tournament-overview"] }),
        queryClient.invalidateQueries({ queryKey: ["tournament-my-votes", userId] }),
      ]);
    },
    onError: (err: any) => {
      const detail = err?.response?.data?.detail;
      setVoteMessage(typeof detail === "string" ? detail : t("oyuns_plus.vote_locked"));
    },
  });

  const handleVote = (category: TournamentCategory, teamId: string) => {
    setVoteMessage("");
    voteMutation.mutate({ category, team_id: teamId });
  };

  const formatGameTime = (startsAt: string) => {
    const dt = new Date(startsAt);
    if (Number.isNaN(dt.getTime())) return startsAt;
    return dt.toLocaleString(undefined, {
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const renderLeaderboard = (category: TournamentCategory, teamsList: typeof teams) => {
    const voteState = voteByCategory[category] || { voted: false, team_id: null };
    return (
      <div className="bg-surface-50 dark:bg-dark-700 rounded-2xl p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-xs font-bold text-dark-800 dark:text-ivory-200">
            {category === "men" ? t("oyuns_plus.vote_men") : t("oyuns_plus.vote_women")}
          </div>
          <div className="text-[11px] text-dark-600 dark:text-ivory-400">
            {voteState.voted ? t("oyuns_plus.vote_submitted") : t("oyuns_plus.vote_one_time")}
          </div>
        </div>
        {teamsList.length === 0 ? (
          <div className="text-xs text-dark-500 dark:text-ivory-400">{t("oyuns_plus.no_teams")}</div>
        ) : (
          teamsList.map((team, index) => {
            const selected = voteState.team_id === team.id;
            const disabled = voteState.voted || voteMutation.isPending;
            return (
              <div
                key={team.id}
                className={`flex items-center justify-between gap-2 rounded-xl border p-2 ${
                  selected ? "border-emerald-500/60 bg-emerald-50 dark:bg-emerald-900/20" : "border-silver/70 dark:border-dark-600 bg-white dark:bg-dark-800"
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <div className="text-xs font-bold text-dark-500 dark:text-ivory-400 w-4">{index + 1}</div>
                  {team.logo_url ? (
                    <img src={team.logo_url} alt={team.name} className="w-7 h-7 rounded-full object-cover border border-silver/50 dark:border-dark-600" />
                  ) : (
                    <div className="w-7 h-7 rounded-full bg-maroon-100 dark:bg-maroon-900/30 flex items-center justify-center text-[10px] font-bold text-maroon-700 dark:text-maroon-300">
                      {(team.short_name || team.name || "?").slice(0, 1).toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-dark-800 dark:text-ivory-200 truncate">{team.name}</div>
                    <div className="text-[11px] text-dark-500 dark:text-ivory-400">{team.votes_count} {t("oyuns_plus.votes")}</div>
                  </div>
                </div>
                <button
                  onClick={() => handleVote(category, team.id)}
                  disabled={disabled}
                  className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition ${
                    selected
                      ? "bg-emerald-600 text-white"
                      : disabled
                      ? "bg-slate-200 dark:bg-dark-600 text-slate-500 dark:text-ivory-400 cursor-not-allowed"
                      : "bg-maroon-600 text-white hover:bg-maroon-500"
                  }`}
                >
                  {selected ? t("oyuns_plus.vote_selected") : t("oyuns_plus.vote_action")}
                </button>
              </div>
            );
          })
        )}
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className="animate-fadeIn space-y-4">
        <h2 className="text-base font-bold text-dark-800 dark:text-ivory-200">{t("profile.oyuns_title")}</h2>
        <div className="bg-white dark:bg-dark-800 rounded-2xl p-5 border border-silver/60 dark:border-dark-600 text-sm text-dark-600 dark:text-ivory-300">
          {t("profile.loading")}
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="animate-fadeIn space-y-4">
        <h2 className="text-base font-bold text-dark-800 dark:text-ivory-200">{t("profile.oyuns_title")}</h2>
        <div className="bg-white dark:bg-dark-800 rounded-2xl p-5 border border-silver/60 dark:border-dark-600 text-sm text-dark-600 dark:text-ivory-300">
          {t("profile.load_failed")}
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fadeIn space-y-4">
      <h2 className="text-base font-bold text-dark-800 dark:text-ivory-200">{t("profile.oyuns_title")}</h2>

      {/* Points summary card - always visible */}
      <div className="bg-gradient-to-br from-maroon-700 via-maroon-800 to-dark-900 dark:from-maroon-900 dark:via-dark-900 dark:to-black rounded-3xl p-5 text-white shadow-card-dark">
        <div className="flex items-center gap-2 mb-4">
          <img src={logoUrl} alt={t("profile.oyuns_title")} className="w-5 h-5 object-contain" />
          <div className="font-bold text-base">{t("profile.oyuns_title")}</div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="bg-white/10 rounded-xl p-3">
            <div className="text-[11px] text-white/70">{t("profile.oyuns_points")}</div>
            <div className="text-2xl font-bold text-gold-400">{data.points_balance}</div>
          </div>
          <div className="bg-white/10 rounded-xl p-3">
            <div className="text-[11px] text-white/70 flex items-center gap-1">
              <Users className="w-3 h-3" />
              {t("profile.oyuns_verified_out_of_invited")}
            </div>
            <div className="text-2xl font-bold">{data.invited_verified}/{data.invited_total}</div>
          </div>
        </div>
      </div>

      {activeTournamentSection === null ? (
        /* Outer selector — Services-style */
        <div className="grid grid-cols-1 gap-3">
          <button
            onClick={() => setActiveTournamentSection("basketball")}
            className="relative overflow-hidden bg-gradient-to-br from-maroon-700 via-maroon-800 to-dark-900 p-5 rounded-3xl text-left text-white active:scale-[0.97] transition-all shadow-lg shadow-maroon-200/30 hover:from-maroon-600 hover:via-maroon-700 hover:to-dark-800"
          >
            <div className="absolute -top-4 -right-4 w-20 h-20 bg-white/10 rounded-full blur-lg" />
            <Trophy className="w-8 h-8 mb-3 opacity-90 text-gold-400" />
            <div className="font-bold text-sm mb-0.5">{t("oyuns_plus.tournament_section_title")}</div>
            <div className="text-[11px] text-white/60 leading-relaxed">{t("oyuns_plus.tournament_desc")}</div>
          </button>
        </div>
      ) : (
        /* Inner view with 2 tabs */
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveTournamentSection(null)}
              className="text-xs text-maroon-600 dark:text-gold-400 font-semibold hover:underline flex items-center gap-1"
            >
              ← {t("common.back")}
            </button>
            <span className="text-dark-400 dark:text-ivory-500">/</span>
            <div className="text-sm font-bold text-dark-800 dark:text-ivory-200">{t("oyuns_plus.tournament_section_title")}</div>
          </div>

          {/* Inner tab switcher */}
          <div className="flex gap-2">
            <button
              onClick={() => setTournamentInnerTab("schedule")}
              className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition ${
                tournamentInnerTab === "schedule" ? "bg-maroon-600 text-white" : "bg-surface-100 dark:bg-dark-700 text-dark-700 dark:text-ivory-300"
              }`}
            >
              {t("oyuns_plus.tab_schedule")}
            </button>
            <button
              onClick={() => setTournamentInnerTab("leaderboard")}
              className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition ${
                tournamentInnerTab === "leaderboard" ? "bg-maroon-600 text-white" : "bg-surface-100 dark:bg-dark-700 text-dark-700 dark:text-ivory-300"
              }`}
            >
              {t("oyuns_plus.tab_leaderboard")}
            </button>
          </div>

          {tournamentInnerTab === "schedule" ? (
            /* Schedule and Scores tab */
            <div className="bg-white dark:bg-dark-800 rounded-3xl p-5 border border-silver/60 dark:border-dark-600 shadow-card space-y-3">
              <div className="flex gap-2 flex-wrap">
                {[
                  { value: "all", label: t("oyuns_plus.filter_all") },
                  { value: "men", label: t("oyuns_plus.vote_men") },
                  { value: "women", label: t("oyuns_plus.vote_women") },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setGameCategoryFilter(opt.value as "all" | TournamentCategory)}
                    className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition ${
                      gameCategoryFilter === opt.value ? "bg-maroon-600 text-white" : "bg-surface-100 dark:bg-dark-700 text-dark-700 dark:text-ivory-300"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              <div className="flex gap-2 flex-wrap">
                {[
                  { value: "all", label: t("oyuns_plus.filter_all_venue") },
                  { value: "a_hall", label: t("oyuns_plus.hall_a") },
                  { value: "b_hall", label: t("oyuns_plus.hall_b") },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setGameVenueFilter(opt.value as "all" | TournamentVenue)}
                    className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition ${
                      gameVenueFilter === opt.value ? "bg-maroon-600 text-white" : "bg-surface-100 dark:bg-dark-700 text-dark-700 dark:text-ivory-300"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              {tournamentLoading ? (
                <div className="text-xs text-dark-600 dark:text-ivory-400">{t("profile.loading")}</div>
              ) : filteredGames.length === 0 ? (
                <div className="text-xs text-dark-600 dark:text-ivory-400">{t("oyuns_plus.no_games")}</div>
              ) : (
                <div className="space-y-2">
                  {filteredGames.slice(0, 12).map((game) => {
                    const isLive = game.status === "live";
                    const isCompleted = game.status === "completed";
                    const homeWins = isCompleted && game.home_score > game.away_score;
                    const awayWins = isCompleted && game.away_score > game.home_score;

                    const TeamLogo = ({ logoUrl, name }: { logoUrl?: string; name?: string }) => (
                      logoUrl ? (
                        <img src={logoUrl} alt={name || ""} className="w-11 h-11 rounded-full object-cover border-2 border-silver/50 dark:border-dark-600 shadow-sm" />
                      ) : (
                        <div className="w-11 h-11 rounded-full bg-maroon-100 dark:bg-maroon-900/30 flex items-center justify-center text-sm font-bold text-maroon-700 dark:text-maroon-300 border-2 border-silver/30 dark:border-dark-600">
                          {(name || "?").slice(0, 1).toUpperCase()}
                        </div>
                      )
                    );

                    return (
                      <div
                        key={game.id}
                        className={`rounded-2xl border-2 p-3 transition-all ${
                          isLive
                            ? "border-rose-500 bg-rose-50/50 dark:bg-rose-950/20 shadow-md shadow-rose-300/30 dark:shadow-rose-900/20"
                            : isCompleted
                            ? "border-silver/40 dark:border-dark-600 bg-white dark:bg-dark-800"
                            : "border-silver/40 dark:border-dark-600 bg-surface-50 dark:bg-dark-700"
                        }`}
                      >
                        {/* Header row: venue + category + status */}
                        <div className="flex items-center justify-between mb-2.5">
                          <div className="flex items-center gap-1 text-[11px] text-dark-500 dark:text-ivory-400">
                            <MapPin className="w-3 h-3" />
                            {game.venue === "a_hall" ? t("oyuns_plus.hall_a") : t("oyuns_plus.hall_b")}
                            <span className="mx-0.5 text-dark-300 dark:text-ivory-600">·</span>
                            <span className="capitalize">{game.category === "men" ? t("oyuns_plus.vote_men") : t("oyuns_plus.vote_women")}</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            {isLive && (
                              <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
                            )}
                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                              isLive
                                ? "bg-rose-500 text-white"
                                : isCompleted
                                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
                                : "bg-slate-100 text-slate-600 dark:bg-dark-600 dark:text-ivory-400"
                            }`}>
                              {t(`oyuns_plus.status_${game.status}`)}
                            </span>
                          </div>
                        </div>

                        {/* Main matchup row: logo | name | score | name | logo */}
                        <div className="flex items-center gap-2">
                          {/* Home team */}
                          <div className="flex flex-col items-center gap-1 flex-1 min-w-0">
                            <TeamLogo logoUrl={game.home_team_logo_url} name={game.home_team_name} />
                            <div className={`text-[11px] text-center leading-tight w-full truncate ${
                              homeWins
                                ? "font-bold text-blue-600 dark:text-blue-400"
                                : awayWins
                                ? "font-normal text-dark-500 dark:text-ivory-400"
                                : "font-medium text-dark-700 dark:text-ivory-200"
                            }`}>
                              {game.home_team_name || t("oyuns_plus.team_unknown")}
                            </div>
                          </div>

                          {/* Score */}
                          <div className="flex flex-col items-center gap-0.5 shrink-0 px-1">
                            <div className={`text-xl font-black tabular-nums tracking-tight ${
                              isLive
                                ? "text-rose-600 dark:text-rose-400"
                                : isCompleted
                                ? "text-dark-800 dark:text-ivory-100"
                                : "text-dark-500 dark:text-ivory-400"
                            }`}>
                              {game.home_score} : {game.away_score}
                            </div>
                            <div className="text-[10px] text-dark-400 dark:text-ivory-500 flex items-center gap-0.5">
                              <Calendar className="w-2.5 h-2.5" />
                              {formatGameTime(game.starts_at)}
                            </div>
                          </div>

                          {/* Away team */}
                          <div className="flex flex-col items-center gap-1 flex-1 min-w-0">
                            <TeamLogo logoUrl={game.away_team_logo_url} name={game.away_team_name} />
                            <div className={`text-[11px] text-center leading-tight w-full truncate ${
                              awayWins
                                ? "font-bold text-blue-600 dark:text-blue-400"
                                : homeWins
                                ? "font-normal text-dark-500 dark:text-ivory-400"
                                : "font-medium text-dark-700 dark:text-ivory-200"
                            }`}>
                              {game.away_team_name || t("oyuns_plus.team_unknown")}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            /* Team leaderboard tab */
            <div className="bg-white dark:bg-dark-800 rounded-3xl p-5 border border-silver/60 dark:border-dark-600 shadow-card space-y-3">
              {voteMessage && (
                <div className="text-xs rounded-lg px-3 py-2 bg-maroon-50 text-maroon-700 dark:bg-maroon-900/20 dark:text-maroon-300 border border-maroon-200/60 dark:border-maroon-800/40">
                  {voteMessage}
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {renderLeaderboard("men", menTeams)}
                {renderLeaderboard("women", womenTeams)}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

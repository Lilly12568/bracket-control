# Bracket Control

A local EUCannon bracket controller that keeps the original bracket page layout.

## Use it

- Click the small **CONTROL** button in the bottom-right corner to open Local Control.
- Paste any EUCannon bracket URL, or enter its numeric bracket ID, and click the download button.
- On first launch, `latest` automatically imports the highest-numbered tournament whose EUCannon phase is Complete; registration-only and in-progress tournaments are skipped.
- Choose the same five tournament phases used by EU Cannon: Upcoming (1), Registration (2), Check-ins (3), In progress (4), or Complete (5).
- In Registration, players are displayed from earliest to latest registration. Click a player to unregister them completely; click them again to restore them.
- In Registration, add a TETR.IO player by username or 24-character MongoDB user ID. Their current profile and ranking details are fetched, and they start registered but not checked in.
- Check-ins are initialized from the imported EUCannon source. The attendance control remains available in every phase, and **Restore imported check-ins** recovers the imported state at any time.
- Mark absent players by clicking their attendance row. They remain registered and appear crossed out with a red dash in phases 4 and 5, but receive no seed and are excluded from matches and final standings.
- If you locally check in someone who had no imported seed, missing group-stage matches are added automatically so their new seed participates in the bracket. Those newly created matches require manual scores because the source has no results for them.
- Edit the checked-in players' seeds in **Seeding**. Every seed from 1 through the checked-in player count must be used exactly once.
- Future room codes stay hidden until both players in that match are known. Turn on **Show future room codes** to display them early.
- Click a match in the original bracket. Reveal imported sets one at a time from its normal details panel, or enter a manual score in Local Control.
- Completed winners and losers automatically feed the dependent matches. Group-stage placements are recalculated after a group finishes.
- Click **Complete all matches** to reveal every downloaded match result at once and switch to Complete (phase 5).
- Final standings are calculated from the current local bracket, including manual score overrides and dedicated placement matches, instead of reusing the downloaded standings.
- Click **Refresh visual resources** to update the bundled page, avatars, flags, rank icons, and other visual assets without changing local match results.

The internet is used only when you explicitly import a bracket (and for the automatic first import when no local bracket exists). The HTML, scripts, styles, avatars, flags, ranks, and icons are stored locally in the browser after import.
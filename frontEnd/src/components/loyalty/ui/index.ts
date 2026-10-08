/**
 * ClinicOS Loyalty design system — one import for the reusable pieces (Phase 8).
 *   LoyaltySurface · LoyaltyPanel · LoyaltyMetric · StatusOrb · ProgressRail · LoyaltyEmptyState · LoyaltyLoader · LoyaltyErrorState · SuccessBurst
 *   SegTabs · LyxSwitch · ActivityItem · CinematicTransition · LoyaltyModal (the accessible Dialog) · PointsMove · TierPromotionMoment · charts
 * 3D cards live next to them: LoyaltyCard3D, TierCard3D, RewardObject.
 */
export * from "./LoyaltyUI";
export { default as LoyaltyModal } from "../Dialog";
export { default as PointsMove } from "./PointsMove";
export { default as TierPromotionMoment, useUnseenPromotion } from "./TierPromotion";
export { DayChart, Donut, HBars, StackBar } from "./LoyaltyCharts";
export { default as LoyaltyCard3D } from "../LoyaltyCard3D";
export { default as TierCard3D, TierBadge } from "../TierCard3D";
export { default as RewardObject } from "../RewardObject";
export * from "../shell/loyaltyDesign";

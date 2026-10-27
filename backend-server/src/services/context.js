import Gym from "../models/Gym.js";
import GymSettings from "../models/GymSettings.js";
import { notFound } from "../lib/errors.js";

/** Load gym + settings (auto-creating the settings row when missing). */
export async function loadGymContext(gymId) {
  const gym = await Gym.findById(gymId).lean();
  if (!gym) throw notFound("Studio not found");

  let settings = await GymSettings.findOne({ gymId }).lean();
  if (!settings) {
    await GymSettings.updateOne({ gymId }, { $setOnInsert: { gymId } }, { upsert: true });
    settings = await GymSettings.findOne({ gymId }).lean();
  }

  const tz = gym.timezone || "Asia/Kolkata";
  return {
    gym,
    settings,
    tz,
    now: new Date(),
    expiringSoonDays: settings?.expiringSoonDays ?? 7,
  };
}

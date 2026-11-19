import { connectDb, disconnectDb } from "../src/db.js";
import { memberLoginEmail } from "../src/lib/memberLogins.js";

const apply = process.argv.includes("--apply");
const db = await connectDb();

try {
  const collections = await db.db.listCollections({}, { nameOnly: true }).toArray();
  const membersCollection = db.db.collection("members");
  const legacyMembers = await membersCollection
    .find({ memberCode: { $type: "string" } })
    .project({ _id: 1, memberCode: 1 })
    .toArray();
  const memberCodes = [...new Set(legacyMembers.map((member) => member.memberCode))];
  const cleanupCounts = [];

  for (const { name } of collections) {
    const collection = db.db.collection(name);
    const count = await collection.countDocuments({
      $or: [{ memberCode: { $exists: true } }, { "meta.memberCode": { $exists: true } }],
    });
    if (count > 0) cleanupCounts.push({ name, count });
  }

  const auditCount = await db.db.collection("auditlogs").countDocuments({
    $or: [{ "oldValues.memberCode": { $exists: true } }, { "newValues.memberCode": { $exists: true } }],
  });
  const memberUserFilter = {
    role: "member",
    memberId: { $type: "objectId" },
    email: /@members\.kalamandir\.local$/i,
  };
  const memberUsers = await db.db.collection("users").find(memberUserFilter).toArray();
  const memberLoginUpdates = memberUsers.map((user) => ({
    user,
    email: memberLoginEmail(user.gymId, user.memberId),
  })).filter(({ user, email }) => user.email.toLowerCase() !== email);
  const loginCollisions = [];
  for (const { user, email } of memberLoginUpdates) {
    const collision = await db.db.collection("users").countDocuments({
      email,
      _id: { $ne: user._id },
    });
    if (collision) loginCollisions.push(email);
  }
  if (loginCollisions.length) {
    throw new Error("Migration stopped: MongoDB-ID login emails would conflict with existing users.");
  }
  const notificationFilter = {
    $or: [
      { body: { $regex: "\\b(?:KD|PG)-\\d{3,8}\\b", $options: "i" } },
      ...memberCodes.map((code) => ({
        body: { $regex: code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" },
      })),
    ],
  };
  const notificationCount = await db.db.collection("notifications").countDocuments(notificationFilter);
  const legacyIndexes = await membersCollection.listIndexes().toArray();
  const memberCodeIndexes = legacyIndexes.filter((index) => index.key?.memberCode !== undefined);

  console.log("Legacy member-code records to clean:");
  console.log(JSON.stringify({
    topLevelFields: cleanupCounts,
    auditEntries: auditCount,
    outdatedSyntheticMemberLogins: memberLoginUpdates.length,
    notificationsWithCodes: notificationCount,
    memberIndexes: memberCodeIndexes.map((index) => index.name),
  }, null, 2));

  if (!apply) {
    console.log("Dry run only. Re-run with --apply to remove these values.");
    process.exitCode = 0;
  } else {
    for (const index of memberCodeIndexes) {
      await membersCollection.dropIndex(index.name);
    }

    for (const { name } of collections) {
      await db.db.collection(name).updateMany(
        { $or: [{ memberCode: { $exists: true } }, { "meta.memberCode": { $exists: true } }] },
        { $unset: { memberCode: "", "meta.memberCode": "" } },
      );
    }

    await db.db.collection("auditlogs").updateMany(
      {
        $or: [{ "oldValues.memberCode": { $exists: true } }, { "newValues.memberCode": { $exists: true } }],
      },
      { $unset: { "oldValues.memberCode": "", "newValues.memberCode": "" } },
    );

    const notifications = db.db.collection("notifications").find(notificationFilter);
    for await (const notification of notifications) {
      let body = notification.body;
      for (const code of memberCodes) {
        const escapedCode = code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        body = body.replace(new RegExp(escapedCode, "gi"), "");
      }
      body = body
        .replace(/\b(?:KD|PG)-\d{3,8}\b/gi, "")
        .replace(/\(\s*\)/g, "")
        .replace(/\s+([—-])/g, " $1")
        .replace(/^\s*[—-]\s*/, "")
        .trim();
      if (body !== notification.body) {
        await db.db.collection("notifications").updateOne(
          { _id: notification._id },
          { $set: { body } },
        );
      }
    }

    for (const { user, email } of memberLoginUpdates) {
      await db.db.collection("users").updateOne(
        { _id: user._id },
        { $set: { email } },
      );
    }

    await db.db.collection("counters").deleteMany({ key: /^member_code:/ });

    console.log("Member-code values and indexes removed.");
  }
} finally {
  await disconnectDb();
}

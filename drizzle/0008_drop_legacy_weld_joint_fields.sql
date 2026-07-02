ALTER TABLE "weld_joints"
  DROP COLUMN IF EXISTS "joint_zone",
  DROP COLUMN IF EXISTS "joint_nominal",
  DROP COLUMN IF EXISTS "index_code",
  DROP COLUMN IF EXISTS "rw_joint",
  DROP COLUMN IF EXISTS "spool_number";

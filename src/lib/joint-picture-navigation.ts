export type JointPictureTab = 'joint' | 'actions' | 'line'

export type JointPictureIntent = {
  initialTab: JointPictureTab
  focusedTaskKey: string | null
}

export const DEFAULT_JOINT_PICTURE_INTENT: JointPictureIntent = {
  initialTab: 'joint',
  focusedTaskKey: null,
}

export type OpenJointPictureOptions = Partial<JointPictureIntent>

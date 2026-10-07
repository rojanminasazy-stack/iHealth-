import {
  ChimeSDKMeetingsClient,
  CreateAttendeeCommand,
  CreateMeetingCommand,
  DeleteMeetingCommand,
  GetMeetingCommand,
  type Attendee,
  type Meeting,
} from "@aws-sdk/client-chime-sdk-meetings";

/**
 * Video visits run on Amazon Chime SDK Meetings (HIPAA-eligible, covered by the AWS BAA).
 * Media is encrypted in transit. Nothing is recorded.
 */
const chime = new ChimeSDKMeetingsClient({});
const MEDIA_REGION = process.env.VIDEO_MEDIA_REGION ?? "us-west-2";

/** Returns the live meeting for a visit, creating one if it doesn't exist or has ended. */
export async function ensureMeeting(requestId: string, existingId?: string): Promise<Meeting> {
  if (existingId) {
    try {
      const r = await chime.send(new GetMeetingCommand({ MeetingId: existingId }));
      if (r.Meeting) return r.Meeting;
    } catch (e) {
      if ((e as { name?: string }).name !== "NotFoundException") throw e;
    }
  }
  const r = await chime.send(
    new CreateMeetingCommand({
      // Idempotent: two people joining at once get the same meeting.
      ClientRequestToken: `${requestId}-${existingId ?? "first"}`.slice(0, 64),
      ExternalMeetingId: requestId.slice(0, 64),
      MediaRegion: MEDIA_REGION,
      MeetingFeatures: { Video: { MaxResolution: "HD" }, Attendee: { MaxCount: 2 } },
    }),
  );
  if (!r.Meeting) throw new Error("Chime returned no meeting");
  return r.Meeting;
}

/** One attendee per join. ExternalUserId is an opaque id: never a name. */
export async function addAttendee(meetingId: string, externalUserId: string): Promise<Attendee> {
  const r = await chime.send(new CreateAttendeeCommand({ MeetingId: meetingId, ExternalUserId: externalUserId.slice(0, 64) }));
  if (!r.Attendee) throw new Error("Chime returned no attendee");
  return r.Attendee;
}

export async function endMeeting(meetingId: string): Promise<void> {
  try {
    await chime.send(new DeleteMeetingCommand({ MeetingId: meetingId }));
  } catch (e) {
    if ((e as { name?: string }).name !== "NotFoundException") throw e;
  }
}

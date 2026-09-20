export { ConnectorError, emailDomain, fetchTransport, type Connector, type RawAttachment, type RawSource, type SyncContext, type SyncItem, type Transport, type TransportInit, type WorkspaceHint } from "./types";
export { GRAPH, graphAuth, graphClient, graphToken, type GraphAuth, type GraphClient } from "./graph";
export { SUBSCRIPTION_MINUTES, TeamsConfig, ensureSubscriptions, meetingsWithoutTranscript, teamsConnector, transcriptSource, type MeetingGap, type Subscription } from "./teams";
export { EmailConfig, emailConnector, messageText, plusTag, threadSource as emailThreadSource, type GraphMessage } from "./email";
export { GROUP_GAP_S, SlackConfig, createSlackConnector, groupMessages, slackApi, slackConnector, sourceForEvent, startSocketMode, threadSource as slackThreadSource, type SlackApi, type SlackEvent, type SlackMessage } from "./slack";
export { sendResendAlert, type Alert, type InlineImage, type ResendConfig } from "./resend";
export { connectors } from "./registry";

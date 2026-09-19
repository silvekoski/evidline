import type { ConnectorKind } from "@tpm/schemas";
import { emailConnector } from "./email";
import { slackConnector } from "./slack";
import { teamsConnector } from "./teams";
import type { Connector } from "./types";

export const connectors: Partial<Record<ConnectorKind, Connector<never>>> = { teams: teamsConnector as Connector<never>, email: emailConnector as Connector<never>, slack: slackConnector as Connector<never> };

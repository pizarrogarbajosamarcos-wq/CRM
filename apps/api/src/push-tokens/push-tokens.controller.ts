import { SESSION_COOKIE_NAME } from "@crm/auth";
import { Body, Controller, Delete, Post, Query } from "@nestjs/common";
import {
	ApiBearerAuth,
	ApiCookieAuth,
	ApiOkResponse,
	ApiOperation,
	ApiSecurity,
	ApiTags,
	ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import type { RequestPrincipal } from "../auth/request-principal";
import { Principal } from "../auth/request-principal.decorator";
import { PushTokensService } from "./push-tokens.service";

@ApiTags("Push tokens")
@ApiCookieAuth(SESSION_COOKIE_NAME)
@ApiSecurity("apiKey")
@ApiBearerAuth("oauth")
@Controller("push-tokens")
export class PushTokensController {
	constructor(private readonly pushTokens: PushTokensService) {}

	@Post()
	@ApiOperation({ summary: "Register this device's FCM token" })
	@ApiOkResponse({ description: "The token was stored." })
	@ApiUnauthorizedResponse({ description: "No valid session." })
	register(@Principal() principal: RequestPrincipal, @Body() body: unknown) {
		return this.pushTokens.register(principal.user.id, body);
	}

	@Delete()
	@ApiOperation({ summary: "Remove this device's FCM token" })
	@ApiOkResponse({
		description: "The token was removed if it belonged to the caller.",
	})
	@ApiUnauthorizedResponse({ description: "No valid session." })
	unregister(
		@Principal() principal: RequestPrincipal,
		@Query("token") token: string,
	) {
		return this.pushTokens.unregister(principal.user.id, token);
	}
}

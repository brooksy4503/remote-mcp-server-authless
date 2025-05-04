import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import FirecrawlApp, { ScrapeResponse, ScrapeParams, ErrorResponse } from '@mendable/firecrawl-js';

interface Env {
	MCP_OBJECT: DurableObjectNamespace;
	FIRECRAWL_API_KEY: string;
}

// Define our MCP agent with tools
export class MyMCP extends McpAgent {
	server = new McpServer({
		name: "Authless MCP with Firecrawl",
		version: "1.0.0",
	});
	env: Env;
	firecrawlApp: FirecrawlApp;
	private initialized = false;

	constructor(state: DurableObjectState, env: Env) {
		super(state, env);
		this.env = env;
		if (!env.FIRECRAWL_API_KEY) {
			console.error("FIRECRAWL_API_KEY secret is not set in the environment!");
			this.firecrawlApp = new FirecrawlApp({ apiKey: 'MISSING_API_KEY' });
		} else {
			this.firecrawlApp = new FirecrawlApp({ apiKey: env.FIRECRAWL_API_KEY });
		}
	}

	async init() {
		if (this.initialized) {
			console.log("Tools already initialized, skipping.");
			return;
		}
		console.log("Initializing tools...");

		// Simple addition tool
		this.server.tool(
			"add",
			{ a: z.number(), b: z.number() },
			async ({ a, b }) => ({
				content: [{ type: "text", text: String(a + b) }],
			})
		);

		// Calculator tool with multiple operations
		this.server.tool(
			"calculate",
			{
				operation: z.enum(["add", "subtract", "multiply", "divide"]),
				a: z.number(),
				b: z.number(),
			},
			async ({ operation, a, b }) => {
				let result: number;
				switch (operation) {
					case "add":
						result = a + b;
						break;
					case "subtract":
						result = a - b;
						break;
					case "multiply":
						result = a * b;
						break;
					case "divide":
						if (b === 0)
							return { error: { code: 'invalid_argument', message: 'Cannot divide by zero' }, content: [] };
						result = a / b;
						break;
				}
				return { content: [{ type: "text", text: String(result) }] };
			}
		);

		// Define simplified Firecrawl scrape tool
		this.server.tool(
			'firecrawl_scrape',
			{
				url: z.string().url().describe('The URL to scrape'),
			},
			async ({ url }) => {
				console.log(`Scraping URL: ${url} (simplified)`);

				try {
					const scrapeResult: any = await this.firecrawlApp.scrapeUrl(url, { formats: ["markdown"] });
					console.log('Simple Scrape Result:', JSON.stringify(scrapeResult, null, 2));

					if (scrapeResult && scrapeResult.success) {
						const markdownContent = scrapeResult.markdown;
						if (!markdownContent) {
							throw new Error("Firecrawl scrape succeeded but returned no markdown content.");
						}
						return { content: [{ type: 'text', text: markdownContent }] };
					} else {
						const errorMsg = scrapeResult?.error || 'Unknown error during scraping execution on Firecrawl';
						console.error(`Simplified Firecrawl scrape failed for ${url}: ${errorMsg}`);
						throw new Error(`Firecrawl scrape failed: ${errorMsg}`);
					}
				} catch (error: any) {
					console.error(`Error during simplified Firecrawl scrape call for ${url}:`, error);
					throw error;
				}
			}
		);

		// Define Firecrawl search tool (Placeholder) - Kept simple
		this.server.tool(
			'firecrawl_search',
			{
				query: z.string().describe('The search query'),
			},
			async ({ query }) => {
				console.log(`Searching with Firecrawl: ${query} (simplified)`);
				console.warn("Firecrawl 'search' tool is not implemented yet as the SDK might lack direct support.");
				throw new Error("Firecrawl 'search' tool is not implemented in this worker yet.");
			}
		);

		this.initialized = true;
		console.log("Tools initialization complete.");
	}
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname === "/sse" || url.pathname === "/sse/message") {
			// Revert to using the serveSSE pattern, likely provided by the base class
			// This pattern probably handles the SSE handshake correctly.
			// @ts-ignore - Suppress potential type errors on serveSSE
			return MyMCP.serveSSE("/sse").fetch(request, env, ctx);
		}

		if (url.pathname === "/mcp") {
			// Keep the direct forwarding for the standard /mcp endpoint
			const durableObjectId = env.MCP_OBJECT.idFromName("shared-instance");
			const durableObjectStub = env.MCP_OBJECT.get(durableObjectId);
			return durableObjectStub.fetch(request);
		}

		return new Response("Not found", { status: 404 });
	},
};

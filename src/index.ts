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
				console.log(`Searching with Firecrawl: ${query}`);
				if (!this.env.FIRECRAWL_API_KEY || this.env.FIRECRAWL_API_KEY === 'MISSING_API_KEY') {
					console.error("Firecrawl API key is missing. Cannot perform search.");
					throw new Error("Firecrawl API key is not configured for the search tool.");
				}

				try {
					// Assuming firecrawlApp.search returns an object with a 'markdown' property
					// containing the compiled results, similar to scrape.
					// The actual structure might differ, adjust as needed based on library specifics.
					const searchResult: any = await this.firecrawlApp.search(query, { pageOptions: { formats: ["markdown"] } });
					console.log('Firecrawl Search Result:', JSON.stringify(searchResult, null, 2));

					// Check for success and extract markdown. The exact structure might vary.
					// Common patterns are direct markdown property or within a nested data/results object.
					// Let's assume a structure like { success: true, markdown: "...", data: [...] } or similar
					if (searchResult && searchResult.success && searchResult.data && Array.isArray(searchResult.data) && searchResult.data.length > 0) {
						// --- Start: Extract first result metadata ---
						/*
						const firstResult = searchResult.data[0];
						console.log(`Extracting first search result: ${firstResult.url}`);

						const resultText = `Title: ${firstResult.title || 'N/A'}\nURL: ${firstResult.url}\nDescription: ${firstResult.description || 'N/A'}`;

						return { content: [{ type: 'text', text: resultText }] };
						*/
						// --- End: Extract first result metadata ---

						// --- Start: Return all search result data as JSON string ---
						console.log(`Returning all ${searchResult.data.length} search results as JSON.`);
						const allResultsJson = JSON.stringify(searchResult.data, null, 2); // Pretty-print JSON
						return { content: [{ type: 'text', text: allResultsJson }] };
						// --- End: Return all search result data as JSON string ---

					} else {
						// If no top-level markdown and no data array, the search might have failed or returned an unexpected format.
						console.warn(`Firecrawl search for "${query}" did not return expected data or markdown.`);
						throw new Error(`Firecrawl search failed or returned empty/unexpected results for query: ${query}`);
					}
				} catch (error: any) {
					console.error(`Error during Firecrawl search call for "${query}":`, error);
					// Re-throw the error so MCP can handle it
					throw new Error(`Failed to execute Firecrawl search: ${error.message || error}`);
				}
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

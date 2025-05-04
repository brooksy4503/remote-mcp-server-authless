# Plan: Integrating Firecrawl Tools into the Cloudflare Worker MCP Server

This document outlines the plan to integrate Firecrawl web scraping and search capabilities into the existing Cloudflare Worker-based MCP server (`remote-mcp-server-authless`).

## 1. Core Concept

The goal is to expose Firecrawl functionalities (scrape, search, crawl, etc.) as MCP tools via the Cloudflare Worker, mirroring the tools available in the dedicated `firecrawl-mcp-server`. The Worker will act as an MCP endpoint and proxy requests to a Firecrawl backend.

## 2. Integration Strategy

-   The Cloudflare Worker (`MyMCP` agent in `src/index.ts`) remains the MCP server endpoint.
-   MCP tools corresponding to Firecrawl capabilities (e.g., `firecrawl_scrape`, `firecrawl_search`) will be defined within the `MyMCP` class.
-   Tool implementations will use a Firecrawl client library (`firecrawl-js`) to interact with either:
    -   The Firecrawl Cloud API ([firecrawl.dev](https://firecrawl.dev/))
    -   A self-hosted instance of `firecrawl-mcp-server`.

## 3. Implementation Steps

1.  **Choose Firecrawl Backend:**
    -   Decide between using the Firecrawl Cloud service (requires API key) or self-hosting `firecrawl-mcp-server`.
2.  **Install Client Library:**
    -   Run `npm install firecrawl-js` in the project directory.
3.  **Configure Environment:**
    -   Store the Firecrawl API key or self-hosted instance URL as a Cloudflare Worker secret (accessible via the `env` object).
4.  **Define Tools in `src/index.ts`:**
    -   Import `FirecrawlApp` from `firecrawl-js`.
    -   Instantiate `FirecrawlApp` within the `MyMCP` class (e.g., in `init()`), using the secret configured in step 3.
    -   For each desired Firecrawl feature:
        -   Define an MCP tool using `this.server.tool()`.
        -   Use `zod` to define the input arguments, matching the `firecrawl-mcp-server` specifications.
        -   Implement the tool's async handler:
            -   Call the corresponding `firecrawl-js` method (e.g., `firecrawlApp.scrape()`).
            -   Pass validated tool arguments to the method.
            -   Process the API response.
            -   Format the result into the required MCP content structure (`{ content: [{ type: "text", text: ... }] }`).
            -   Implement error handling for API failures, returning appropriate MCP error responses. 
import {
  handleGetLibraries,
  handleSearchLibraries,
  handleSearch,
  handleGetItem,
  handleGetCollections,
  handleSearchCollections,
  handleGetCollectionDetails,
  handleGetCollectionItems,
  handleGetSubcollections,
  handleSearchFulltext,
  handleGetItemAbstract,
  handleCreateCollection,
  handleUpdateCollection,
  handleDeleteCollection,
  handleAddItemsToCollection,
  handleRemoveItemsFromCollection,
} from './apiHandlers';
import { UnifiedContentExtractor } from './unifiedContentExtractor';
import { SmartAnnotationExtractor } from './smartAnnotationExtractor';
import { MCPSettingsService } from './mcpSettingsService';
import { getSemanticSearchService, SemanticSearchService, type SemanticSearchResult } from './semantic';
import { rrfFuse, analyzeQuery } from './semantic/hybridSearch';
import { handleSearchRequest } from './searchEngine';
import { runUserJavaScript } from "./evalTool";
import { negotiateProtocolVersion, LATEST_PROTOCOL_VERSION } from './mcpProtocol';
import { config } from "../../package.json";
import { reloadPlugin, installPluginFromUrl } from "./devTools";
import { importByIdentifier, findMissingPdfs, normalizeStringList } from "./importService";
import { checkRetractions, findRelatedPapers } from "./scholarlyService";
import { synthesizeAnnotations } from "./synthesisService";
import { findDuplicates, mergeDuplicates, batchUpdateTags } from "./maintenanceService";
import { parseResolvers, mergeResolvers, buildResolver, RESOLVER_PRESETS } from "./pdfResolvers";
import { syncScihubResolvers, parseSources, DEFAULT_SCIHUB_SOURCES } from "./scihubSources";
import { extractIdentifiers } from "./pdfIdentifier";
import { titleSimilarity, MATCH_THRESHOLD } from './titleSimilarity';
import { cslToZoteroFields, computeEnrichPatch, reconstructAbstract, shouldReplaceCreators, FILL_MISSING_FIELDS } from './metadataMerge';

export interface MCPRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: any;
}



export interface MCPResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
  sessionId?: string;
}

export interface MCPNotification {
  jsonrpc: '2.0';
  method: string;
  params?: any;
}

/**
 * Streamable HTTP-based MCP Server integrated into Zotero Plugin
 *
 * This provides a complete MCP (Model Context Protocol) server implementation
 * that runs directly within the Zotero plugin. AI clients can connect using
 * streamable HTTP requests for real-time bidirectional communication.
 *
 * Architecture: AI Client (streamable HTTP) ↔ Zotero Plugin (integrated MCP server)
 */
export class StreamableMCPServer {
  private isInitialized: boolean = false;
  private serverInfo = {
    name: 'zotero-integrated-mcp',
    version: '1.1.0',
  };
  private clientSessions: Map<string, { initTime: Date; lastActivity: Date; clientInfo?: any }> = new Map();

  constructor() {
    // No initialization needed - using direct function calls
  }

  /**
   * Handle incoming MCP requests and return HTTP response
   */
  async handleMCPRequest(requestBody: string): Promise<{ status: number; statusText: string; headers: any; body: string }> {
    let parsedRequest: unknown;

    try {
      parsedRequest = JSON.parse(requestBody);
    } catch (error) {
      ztoolkit.log(`[StreamableMCP] Parse error: ${error}`);

      const errorResponse: MCPResponse = {
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32700,
          message: 'Parse error'
        }
      };

      return {
        status: 400,
        statusText: "Bad Request",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify(errorResponse)
      };
    }

    try {
      if (Array.isArray(parsedRequest)) {
        const batchError = this.createError(null, -32600, 'Invalid Request: batch requests are not supported');
        return {
          status: 400,
          statusText: "Bad Request",
          headers: { "Content-Type": "application/json; charset=utf-8" },
          body: JSON.stringify(batchError)
        };
      }

      if (!parsedRequest || typeof parsedRequest !== 'object') {
        const invalidRequest = this.createError(null, -32600, 'Invalid Request');
        return {
          status: 400,
          statusText: "Bad Request",
          headers: { "Content-Type": "application/json; charset=utf-8" },
          body: JSON.stringify(invalidRequest)
        };
      }

      const request = parsedRequest as MCPRequest;
      if (typeof request.method !== 'string' || !request.method.trim()) {
        const invalidRequest = this.createError(null, -32600, 'Invalid Request: method is required');
        return {
          status: 400,
          statusText: "Bad Request",
          headers: { "Content-Type": "application/json; charset=utf-8" },
          body: JSON.stringify(invalidRequest)
        };
      }

      ztoolkit.log(`[StreamableMCP] Received: ${request.method}`);

      const response = await this.processRequest(request);

      if (response === null) {
        return {
          status: 202,
          statusText: "Accepted",
          headers: { "Content-Type": "application/json; charset=utf-8" },
          body: ''
        };
      }

      const status = this.getHttpStatusForResponse(response);
      return {
        status,
        statusText: status === 400 ? "Bad Request" : "OK",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify(response)
      };
      
    } catch (error) {
      ztoolkit.log(`[StreamableMCP] Error handling request: ${error}`);
      
      const errorResponse: MCPResponse = {
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32603,
          message: 'Internal error'
        }
      };
      
      return {
        status: 400,
        statusText: "Bad Request",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify(errorResponse)
      };
    }
  }

  /**
   * Process individual MCP requests
   */
  private async processRequest(request: MCPRequest): Promise<MCPResponse | null> {
    const isNotification = this.isNotificationRequest(request);

    if (isNotification) {
      switch (request.method) {
        case 'initialized':
        case 'notifications/initialized':
          this.isInitialized = true;
          ztoolkit.log('[StreamableMCP] Client initialized (notification)');
          return null;
        default:
          if (request.method.startsWith('notifications/')) {
            ztoolkit.log(`[StreamableMCP] Ignoring unsupported notification: ${request.method}`);
            return null;
          }
          return this.createError(null, -32600, `Invalid Request: id is required for method ${request.method}`);
      }
    }

    try {
      switch (request.method) {
        case 'initialize':
          return this.handleInitialize(request);

        case 'initialized':
        case 'notifications/initialized':
          this.isInitialized = true;
          ztoolkit.log('[StreamableMCP] Client initialized');
          return this.createResponse(request.id ?? null, { success: true });

        case 'tools/list':
          return this.handleToolsList(request);

        case 'tools/call':
          return await this.handleToolCall(request);

        case 'resources/list':
          return this.handleResourcesList(request);

        case 'prompts/list':
          return this.handlePromptsList(request);

        case 'ping':
          return this.handlePing(request);

        default:
          return this.createError(request.id ?? null, -32601, `Method not found: ${request.method}`);
      }
    } catch (error) {
      ztoolkit.log(`[StreamableMCP] Error processing ${request.method}: ${error}`);
      return this.createError(request.id ?? null, -32603, 'Internal error');
    }
  }

  private handleInitialize(request: MCPRequest): MCPResponse {
    // Extract client info from initialize request
    const clientInfo = request.params?.clientInfo || {};
    const sessionId = this.generateSessionId();
    
    // Store session info
    this.clientSessions.set(sessionId, {
      initTime: new Date(),
      lastActivity: new Date(),
      clientInfo
    });
    
    ztoolkit.log(`[StreamableMCP] Client initialized with session: ${sessionId}, client: ${clientInfo.name || 'unknown'}`);
    
    // Create standard MCP initialize response (no custom fields)
    return this.createResponse(request.id ?? null, {
      protocolVersion: negotiateProtocolVersion((request.params as any)?.protocolVersion),
      capabilities: {
        tools: {
          listChanged: false, // ponytail: POST-only transport has no server→client push channel
        },
      },
      serverInfo: this.serverInfo,
    });
  }

  private generateSessionId(): string {
    return 'mcp-session-' + Date.now().toString(36) + '-' + Math.random().toString(36).substr(2, 9);
  }

  private handleResourcesList(request: MCPRequest): MCPResponse {
    // Return empty resources list - we don't currently support resources
    return this.createResponse(request.id ?? null, { resources: [] });
  }

  private handlePromptsList(request: MCPRequest): MCPResponse {
    // Return empty prompts list - we don't currently support prompts
    return this.createResponse(request.id ?? null, { prompts: [] });
  }

  private handlePing(request: MCPRequest): MCPResponse {
    // Standard MCP ping response - just return empty result
    return this.createResponse(request.id ?? null, {});
  }

  private getHttpStatusForResponse(response: MCPResponse): number {
    if (!response.error) {
      return 200;
    }

    // Align transport status for structural request errors.
    if (response.error.code === -32600 || response.error.code === -32700) {
      return 400;
    }

    return 200;
  }


  private handleToolsList(request: MCPRequest): MCPResponse {
    const tools = [
      {
        name: 'get_libraries',
        description: 'List all Zotero libraries available in the current client. Returns minimal library metadata for each library as a paginated array.',
        inputSchema: {
          type: 'object',
          properties: {
            limit: { type: 'number', description: 'Maximum results to return' },
            offset: { type: 'number', description: 'Pagination offset' },
          },
        },
      },
      {
        name: 'search_library',
        description: 'Search the Zotero library with advanced parameters, boolean operators, relevance scoring, and pagination. Results are from user\'s personal library. Use itemKey with get_content for full text. To find standalone PDFs without metadata, use itemType="attachment" with includeAttachments="true".',
        inputSchema: {
          type: 'object',
          properties: {
            libraryID: {
              type: 'number',
              description: 'Optional target Zotero library ID. Defaults to the user library when omitted.'
            },
            q: { type: 'string', description: 'General search query' },
            title: { type: 'string', description: 'Title search' },
            titleOperator: {
              type: 'string',
              enum: ['contains', 'exact', 'startsWith', 'endsWith', 'regex'],
              description: 'Title search operator'
            },
            yearRange: { type: 'string', description: 'Year range (e.g., "2020-2023")' },
            fulltext: { type: 'string', description: 'Full-text search in attachments and notes' },
            fulltextMode: {
              type: 'string',
              enum: ['attachment', 'note', 'both'],
              description: 'Full-text search mode: attachment (PDFs only), note (notes only), both (default)'
            },
            fulltextOperator: {
              type: 'string',
              enum: ['contains', 'exact', 'regex'],
              description: 'Full-text search operator (default: contains)'
            },
            itemType: {
              type: 'string',
              description: 'Filter by item type (e.g., "attachment" to list standalone files like PDFs imported without metadata, "journalArticle", "book", etc.)'
            },
            includeAttachments: {
              type: 'string',
              enum: ['true', 'false'],
              description: 'Include standalone attachment items (e.g., PDFs without parent item) in results. Must be "true" when itemType is "attachment". Default: false.'
            },
            mode: {
              type: 'string',
              enum: ['minimal', 'preview', 'standard', 'complete'],
              description: 'Processing mode: minimal (30 results), preview (100), standard (adaptive), complete (500+). Uses user default if not specified.'
            },
            relevanceScoring: { type: 'boolean', description: 'Enable relevance scoring' },
            sort: {
              type: 'string',
              enum: ['relevance', 'date', 'title', 'year'],
              description: 'Sort order'
            },
            limit: { type: 'number', description: 'Maximum results to return (overrides mode default)' },
            offset: { type: 'number', description: 'Pagination offset' },
          },
        },
      },
      {
        name: 'search_libraries',
        description: 'Search libraries by name',
        inputSchema: {
          type: 'object',
          properties: {
            q: { type: 'string', description: 'Library name search query' },
            limit: { type: 'number', description: 'Maximum results to return' },
            offset: { type: 'number', description: 'Pagination offset' },
          },
          required: ['q'],
        },
      },
      {
        name: 'search_annotations',
        description: 'Search and filter annotations (highlights, notes, comments) by query, colors, or tags. Returns user\'s personal research notes with relevance scoring. Preserve exact wording when quoting.',
        inputSchema: {
          type: 'object',
          properties: {
            libraryID: {
              type: 'number',
              description: 'Optional target Zotero library ID. Defaults to the user library when omitted.'
            },
            q: { type: 'string', description: 'Search query (optional if colors or tags provided)' },
            itemKeys: {
              type: 'array',
              items: { type: 'string' },
              description: 'Limit search to specific items'
            },
            types: {
              type: 'array',
              items: {
                type: 'string',
                enum: ['note', 'highlight', 'annotation', 'ink', 'text', 'image']
              },
              description: 'Types of annotations to search'
            },
            colors: {
              type: 'array',
              items: { type: 'string' },
              description: 'Filter by colors. Use hex codes (#ffd400) or names (yellow, red, green, blue, purple, orange). Common mappings: yellow=question, red=error/important, green=agree, blue=info, purple=definition'
            },
            tags: {
              type: 'array',
              items: { type: 'string' },
              description: 'Filter by tags attached to annotations'
            },
            mode: {
              type: 'string',
              enum: ['standard', 'preview', 'complete', 'minimal'],
              description: 'Content processing mode (uses user setting default if not specified)'
            },
            maxTokens: {
              type: 'number',
              description: 'Token budget (uses user setting default if not specified)'
            },
            minRelevance: {
              type: 'number',
              minimum: 0,
              maximum: 1,
              default: 0.1,
              description: 'Minimum relevance threshold (only applies when q is provided)'
            },
            limit: { type: 'number', default: 15, description: 'Maximum results' },
            offset: { type: 'number', default: 0, description: 'Pagination offset' }
          },
          description: 'Requires at least one of: q (query), colors, or tags'
        },
      },
      {
        name: 'get_item_details',
        description: 'Get detailed bibliographic metadata for a specific item (title, authors, dates, identifiers, attachments, notes, tags). Use get_content for full text. Suitable for generating citations and references.',
        inputSchema: {
          type: 'object',
          properties: {
            libraryID: {
              type: 'number',
              description: 'Optional target Zotero library ID. Defaults to the user library when omitted.'
            },
            itemKey: { type: 'string', description: 'Unique item key' },
            mode: {
              type: 'string',
              enum: ['minimal', 'preview', 'standard', 'complete'],
              description: 'Processing mode: minimal (basic info), preview (key fields), standard (comprehensive), complete (all fields). Uses user default if not specified.'
            },
          },
          required: ['itemKey'],
        },
      },
      {
        name: 'get_annotations',
        description: 'Get annotations and notes for specific items with color/tag filtering. REQUIRED: provide one of itemKey, annotationId, or annotationIds (use search_library first to find the itemKey; use search_annotations to search by colors/tags across the library). Returns user\'s personal highlights and comments from PDFs. Preserve exact wording when quoting.',
        inputSchema: {
          type: 'object',
          properties: {
            libraryID: {
              type: 'number',
              description: 'Optional target Zotero library ID. Defaults to the user library when omitted.'
            },
            itemKey: { type: 'string', description: 'Get all annotations for this item' },
            annotationId: { type: 'string', description: 'Get specific annotation by ID' },
            annotationIds: {
              type: 'array',
              items: { type: 'string' },
              description: 'Get multiple annotations by IDs'
            },
            types: {
              type: 'array',
              items: {
                type: 'string',
                enum: ['note', 'highlight', 'annotation', 'ink', 'text', 'image']
              },
              default: ['note', 'highlight', 'annotation'],
              description: 'Types of annotations to include'
            },
            colors: {
              type: 'array',
              items: { type: 'string' },
              description: 'Filter by colors. Use hex codes (#ffd400) or names (yellow, red, green, blue, purple, orange). Example: ["yellow", "red"] to get question and error annotations'
            },
            tags: {
              type: 'array',
              items: { type: 'string' },
              description: 'Filter by tags attached to annotations'
            },
            mode: {
              type: 'string',
              enum: ['standard', 'preview', 'complete', 'minimal'],
              description: 'Content processing mode (uses user setting default if not specified)'
            },
            maxTokens: {
              type: 'number',
              description: 'Token budget (uses user setting default if not specified)'
            },
            limit: { type: 'number', default: 20, description: 'Maximum results' },
            offset: { type: 'number', default: 0, description: 'Pagination offset' }
          },
          description: 'Requires either itemKey, annotationId, or annotationIds parameter'
        },
      },
      {
        name: 'get_content',
        description: 'Get full-text content from PDFs, attachments, notes, and abstracts. May contain OCR artifacts. When user asks for complete text, provide it without summarization.',
        inputSchema: {
          type: 'object',
          properties: {
            libraryID: {
              type: 'number',
              description: 'Optional target Zotero library ID. Defaults to the user library when omitted.'
            },
            itemKey: { type: 'string', description: 'Item key to get all content from this item' },
            attachmentKey: { type: 'string', description: 'Attachment key to get content from specific attachment' },
            mode: {
              type: 'string',
              enum: ['minimal', 'preview', 'standard', 'complete'],
              description: 'Content processing mode: minimal (500 chars, fastest), preview (1.5K chars, quick scan), standard (3K chars, balanced), complete (unlimited, complete content). Uses user default if not specified.'
            },
            include: {
              type: 'object',
              properties: {
                pdf: { type: 'boolean', default: true, description: 'Include PDF attachments content' },
                attachments: { type: 'boolean', default: true, description: 'Include other attachments content' },
                notes: { type: 'boolean', default: true, description: 'Include notes content' },
                abstract: { type: 'boolean', default: true, description: 'Include abstract' },
                webpage: { type: 'boolean', default: false, description: 'Include webpage snapshots (auto-enabled in standard/complete modes)' }
              },
              description: 'Content types to include (only applies to itemKey)'
            },
            contentControl: {
              type: 'object',
              properties: {
                preserveOriginal: { type: 'boolean', default: true, description: 'Always preserve original text structure when processing' },
                allowExtended: { type: 'boolean', default: false, description: 'Allow retrieving more content than mode default when important' },
                expandIfImportant: { type: 'boolean', default: false, description: 'Expand content length for high-importance content' },
                maxContentLength: { type: 'number', description: 'Override maximum content length for this request' },
                prioritizeCompleteness: { type: 'boolean', default: false, description: 'Prioritize complete sentences/paragraphs over strict length limits' },
                standardExpansion: {
                  type: 'object',
                  properties: {
                    enabled: { type: 'boolean', default: false, description: 'Enable standard content expansion' },
                    trigger: { 
                      type: 'string', 
                      enum: ['high_importance', 'user_query', 'context_needed'],
                      default: 'high_importance',
                      description: 'Trigger condition for standard expansion'
                    },
                    maxExpansionRatio: { type: 'number', default: 2.0, minimum: 1.0, maximum: 10.0, description: 'Maximum expansion ratio (1.0 = no expansion, 2.0 = double)' }
                  },
                  description: 'Smart expansion configuration'
                }
              },
              description: 'Advanced content control parameters to override mode defaults'
            },
            format: { 
              type: 'string', 
              enum: ['json', 'text'],
              default: 'json',
              description: 'Output format: json (structured with metadata) or text (plain text)' 
            }
          },
          description: 'Requires either itemKey or attachmentKey parameter'
        },
      },
      {
        name: 'get_collections',
        description: 'Get collections in the library. By default returns a flat, paginated list of top-level collections. Use recursive=true to retrieve the complete nested collection tree (all levels) in one call. Use parentCollection to scope to a specific parent\'s direct children.',
        inputSchema: {
          type: 'object',
          properties: {
            libraryID: {
              type: 'number',
              description: 'Optional target Zotero library ID. Defaults to the user library when omitted.'
            },
            mode: {
              type: 'string',
              enum: ['minimal', 'preview', 'standard', 'complete'],
              description: 'Processing mode: minimal (20 collections), preview (50), standard (100), complete (500+). Uses user default if not specified. Ignored when recursive=true.'
            },
            limit: { type: 'number', description: 'Maximum results to return (overrides mode default). Ignored when recursive=true.' },
            offset: { type: 'number', description: 'Pagination offset. Ignored when recursive=true.' },
            recursive: {
              type: 'boolean',
              description: 'When true, recursively return the full nested collection tree. Each collection includes a subcollections array of its children. Pagination is ignored.'
            },
            parentCollection: {
              type: 'string',
              description: 'Key of a parent collection. When provided, returns direct children of that collection instead of top-level collections.'
            },
          },
        },
      },
      {
        name: 'search_collections',
        description: 'Search collections by name',
        inputSchema: {
          type: 'object',
          properties: {
            libraryID: {
              type: 'number',
              description: 'Optional target Zotero library ID. Defaults to the user library when omitted.'
            },
            q: { type: 'string', description: 'Collection name search query' },
            limit: { type: 'number', description: 'Maximum results to return' },
          },
        },
      },
      {
        name: 'get_collection_details',
        description: 'Get detailed information about a specific collection',
        inputSchema: {
          type: 'object',
          properties: {
            collectionKey: { type: 'string', description: 'Collection key' },
            libraryID: {
              type: 'number',
              description: 'Optional target Zotero library ID. Defaults to the user library when omitted.'
            },
          },
          required: ['collectionKey'],
        },
      },
      {
        name: 'get_collection_items',
        description: 'Get items in a specific collection',
        inputSchema: {
          type: 'object',
          properties: {
            collectionKey: { type: 'string', description: 'Collection key' },
            libraryID: {
              type: 'number',
              description: 'Optional target Zotero library ID. Defaults to the user library when omitted.'
            },
            limit: { type: 'number', description: 'Maximum results to return' },
            offset: { type: 'number', description: 'Pagination offset' },
          },
          required: ['collectionKey'],
        },
      },
      {
        name: 'get_subcollections',
        description: 'Get subcollections (child collections) of a specific collection. Use recursive=true to retrieve the full nested hierarchy of all descendant collections.',
        inputSchema: {
          type: 'object',
          properties: {
            collectionKey: { type: 'string', description: 'Parent collection key' },
            libraryID: {
              type: 'number',
              description: 'Optional target Zotero library ID. Defaults to the user library when omitted.'
            },
            limit: { type: 'number', description: 'Maximum results to return (default: 100). Ignored when recursive=true.' },
            offset: { type: 'number', description: 'Pagination offset (default: 0). Ignored when recursive=true.' },
            recursive: { 
              type: 'boolean', 
              description: 'When true, recursively return all descendant subcollections as a nested tree (default: false).' 
            },
          },
          required: ['collectionKey'],
        },
      },
      {
        name: 'create_collection',
        description: 'Create a new collection in the library. Optionally nest it under a parent collection.',
        inputSchema: {
          type: 'object',
          properties: {
            libraryID: {
              type: 'number',
              description: 'Optional target Zotero library ID. Defaults to the user library when omitted.'
            },
            name: { type: 'string', description: 'Name of the new collection' },
            parentCollection: {
              type: 'string',
              description: 'Key of the parent collection. If omitted, creates a top-level collection.'
            },
          },
          required: ['name'],
        },
      },
      {
        name: 'update_collection',
        description: 'Rename or move an existing collection. Provide name to rename, parentCollection to move (empty string moves to top level).',
        inputSchema: {
          type: 'object',
          properties: {
            libraryID: {
              type: 'number',
              description: 'Optional target Zotero library ID. Defaults to the user library when omitted.'
            },
            collectionKey: { type: 'string', description: 'Key of the collection to update' },
            name: { type: 'string', description: 'New name for the collection' },
            parentCollection: {
              type: 'string',
              description: 'Key of the new parent collection. Use empty string "" to move to top level.'
            },
          },
          required: ['collectionKey'],
        },
      },
      {
        name: 'delete_collection',
        description: 'Delete a collection. WARNING: This is a destructive operation. By default, items in the collection are NOT deleted (only removed from the collection). Set deleteItems=true to also send items to trash.',
        inputSchema: {
          type: 'object',
          properties: {
            libraryID: {
              type: 'number',
              description: 'Optional target Zotero library ID. Defaults to the user library when omitted.'
            },
            collectionKey: { type: 'string', description: 'Key of the collection to delete' },
            deleteItems: {
              type: 'boolean',
              description: 'If true, also send items in the collection to trash. Default: false (items remain in library).'
            },
          },
          required: ['collectionKey'],
        },
      },
      {
        name: 'add_items_to_collection',
        description: 'Add one or more items to a collection by their item keys.',
        inputSchema: {
          type: 'object',
          properties: {
            libraryID: {
              type: 'number',
              description: 'Optional target Zotero library ID. Defaults to the user library when omitted.'
            },
            collectionKey: { type: 'string', description: 'Key of the target collection' },
            itemKeys: {
              type: 'array',
              items: { type: 'string' },
              description: 'Array of item keys to add to the collection'
            },
          },
          required: ['collectionKey', 'itemKeys'],
        },
      },
      {
        name: 'remove_items_from_collection',
        description: 'Remove one or more items from a collection. Items are NOT deleted from the library, only removed from this collection.',
        inputSchema: {
          type: 'object',
          properties: {
            libraryID: {
              type: 'number',
              description: 'Optional target Zotero library ID. Defaults to the user library when omitted.'
            },
            collectionKey: { type: 'string', description: 'Key of the collection' },
            itemKeys: {
              type: 'array',
              items: { type: 'string' },
              description: 'Array of item keys to remove from the collection'
            },
          },
          required: ['collectionKey', 'itemKeys'],
        },
      },
      {
        name: 'search_fulltext',
        description: 'Search within full-text content of all documents. Returns matching passages with context. Use get_content with itemKey for complete text of a result.',
        inputSchema: {
          type: 'object',
          properties: {
            libraryID: {
              type: 'number',
              description: 'Optional target Zotero library ID. Defaults to the user library when omitted.'
            },
            q: { type: 'string', description: 'Search query' },
            itemKeys: { 
              type: 'array', 
              items: { type: 'string' },
              description: 'Limit search to specific items (optional)' 
            },
            mode: {
              type: 'string',
              enum: ['minimal', 'preview', 'standard', 'complete'],
              description: 'Processing mode: minimal (100 context), preview (200), standard (adaptive), complete (400+). Uses user default if not specified.'
            },
            contextLength: { type: 'number', description: 'Context length around matches (overrides mode default)' },
            maxResults: { type: 'number', description: 'Maximum results to return (overrides mode default)' },
            caseSensitive: { type: 'boolean', description: 'Case sensitive search (default: false)' },
          },
          required: ['q'],
        },
      },
      {
        name: 'get_item_abstract',
        description: 'Get the abstract/summary of a specific item. Typically the author\'s own summary from the original publication.',
        inputSchema: {
          type: 'object',
          properties: {
            libraryID: {
              type: 'number',
              description: 'Optional target Zotero library ID. Defaults to the user library when omitted.'
            },
            itemKey: { type: 'string', description: 'Item key' },
            format: {
              type: 'string',
              enum: ['json', 'text'],
              description: 'Response format (default: json)'
            },
          },
          required: ['itemKey'],
        },
      },
      // Semantic Search Tools
      {
        name: 'semantic_search',
        description: 'AI-powered semantic search using embeddings. Finds conceptually related content even without exact keyword matches. Combine with keyword search (search_library, search_fulltext) for comprehensive results.',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Natural language search query (e.g., "machine learning in healthcare")'
            },
            topK: {
              type: 'number',
              description: 'Number of results to return (default: 10)'
            },
            minScore: {
              type: 'number',
              description: 'Minimum similarity score 0-1 (default: 0.3)'
            },
            language: {
              type: 'string',
              enum: ['zh', 'en', 'all'],
              description: 'Filter by language (default: all)'
            },
            mode: {
              type: 'string',
              enum: ['hybrid', 'semantic'],
              description: 'hybrid (default): RRF fusion of vector + keyword search — better for author/year/acronym queries. semantic: pure vector (pre-existing behavior).',
            },
          },
          required: ['query']
        }
      },
      {
        name: 'find_similar',
        description: 'Find items semantically similar to a given item using AI embeddings. Useful for expanding research from a known relevant paper and discovering thematic clusters.',
        inputSchema: {
          type: 'object',
          properties: {
            itemKey: {
              type: 'string',
              description: 'The item key to find similar items for'
            },
            topK: {
              type: 'number',
              description: 'Number of similar items to return (default: 5)'
            },
            minScore: {
              type: 'number',
              description: 'Minimum similarity score 0-1 (default: 0.5)'
            }
          },
          required: ['itemKey']
        }
      },
      {
        name: 'semantic_status',
        description: 'Get the status of the semantic search service including index statistics.',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      },
      // Full-text Database Tool (read-only operations)
      {
        name: 'fulltext_database',
        description: 'Access the cached full-text content database (read-only). Faster than re-extracting from Zotero. Actions: list (cached items), search (find text), get (retrieve content), stats (database info).',
        inputSchema: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: ['list', 'search', 'get', 'stats'],
              description: 'Action: list (show cached items), search (search within content), get (get full content), stats (database statistics)'
            },
            query: {
              type: 'string',
              description: 'Search query (required for search action)'
            },
            itemKeys: {
              type: 'array',
              items: { type: 'string' },
              description: 'Item keys for get action'
            },
            limit: {
              type: 'number',
              description: 'Maximum results to return (default: 20 for list/search)'
            },
            caseSensitive: {
              type: 'boolean',
              description: 'Case sensitive search (default: false)'
            }
          },
          required: ['action']
        }
      },
      // Write Tools
      {
        name: 'write_note',
        description: 'Create or modify Zotero notes. Supports child notes (attached to items), standalone notes, updating, or appending. Markdown is auto-converted to HTML. Confirm with user before writing.',
        inputSchema: {
          type: 'object',
          properties: {
            libraryID: {
              type: 'number',
              description: 'Optional target Zotero library ID. Defaults to the user library when omitted.'
            },
            action: {
              type: 'string',
              enum: ['create', 'update', 'append'],
              description: 'create: new note, update: replace content, append: add to end'
            },
            parentKey: {
              type: 'string',
              description: 'Item key to attach note to (create action only, omit for standalone note)'
            },
            noteKey: {
              type: 'string',
              description: 'Existing note key (required for update/append actions)'
            },
            content: {
              type: 'string',
              description: 'Note content in HTML or Markdown format. Markdown is auto-converted to HTML for Zotero storage.'
            },
            tags: {
              type: 'array',
              items: { type: 'string' },
              description: 'Tags to add to the note'
            }
          },
          required: ['action', 'content']
        }
      },
      {
        name: 'write_tag',
        description: 'Add, remove, or replace tags on Zotero items. Works on any item type. Response includes before/after tag lists for verification. Confirm with user before executing.',
        inputSchema: {
          type: 'object',
          properties: {
            libraryID: {
              type: 'number',
              description: 'Optional target Zotero library ID. Defaults to the user library when omitted.'
            },
            action: {
              type: 'string',
              enum: ['add', 'remove', 'set'],
              description: 'add: add tags (keep existing), remove: remove specific tags, set: replace all tags with provided list'
            },
            itemKey: {
              type: 'string',
              description: 'Item key to modify tags on'
            },
            tags: {
              type: 'array',
              items: { type: 'string' },
              description: 'Tags to add/remove/set'
            }
          },
          required: ['action', 'itemKey', 'tags']
        }
      },
      {
        name: 'write_metadata',
        description: 'Update metadata fields on Zotero items (title, abstract, date, URL, DOI, creators, etc.). Only works on regular items, not notes or attachments. Confirm with user before executing.',
        inputSchema: {
          type: 'object',
          properties: {
            libraryID: {
              type: 'number',
              description: 'Optional target Zotero library ID. Defaults to the user library when omitted.'
            },
            itemKey: {
              type: 'string',
              description: 'Item key to update metadata on'
            },
            fields: {
              type: 'object',
              description: 'Fields to update. Common fields: title, abstractNote, date, url, DOI, language, shortTitle, volume, issue, pages, publisher, place, ISBN, ISSN, extra, rights, series, seriesNumber, edition, numPages, journalAbbreviation, publicationTitle, bookTitle',
              additionalProperties: { type: 'string' }
            },
            creators: {
              type: 'array',
              description: 'Set the creators list (replaces all existing creators). Each creator has creatorType (author/editor/translator/etc.), and either firstName+lastName or name (for organizations).',
              items: {
                type: 'object',
                properties: {
                  creatorType: {
                    type: 'string',
                    description: 'Creator type: author, editor, translator, contributor, bookAuthor, seriesEditor, reviewedAuthor, etc.'
                  },
                  firstName: { type: 'string', description: 'First name (for individuals)' },
                  lastName: { type: 'string', description: 'Last name (for individuals)' },
                  name: { type: 'string', description: 'Full name (for organizations, use instead of firstName/lastName)' }
                },
                required: ['creatorType']
              }
            }
          },
          required: ['itemKey']
        }
      },
      {
        name: 'write_item',
        description: 'Create a new Zotero item, re-parent existing attachments, or import a local file as an attachment. Common workflows: (1) read PDF → extract metadata → create item → attach PDF via attachmentKeys; (2) convert PDF to Markdown → import the .md file as attachment via import action. Confirm with user before executing.',
        inputSchema: {
          type: 'object',
          properties: {
            libraryID: {
              type: 'number',
              description: 'Optional target Zotero library ID. Defaults to the user library when omitted.'
            },
            action: {
              type: 'string',
              enum: ['create', 'reparent', 'import'],
              description: 'create: create a new item with metadata. reparent: move an attachment under a different parent item. import: import a local file (e.g., Markdown, PDF) as an attachment to an existing item.'
            },
            itemType: {
              type: 'string',
              description: 'Item type for create action (e.g., journalArticle, book, conferencePaper, thesis, report, webpage, preprint, bookSection, etc.)'
            },
            fields: {
              type: 'object',
              description: 'Metadata fields for create action. Common: title, abstractNote, date, url, DOI, language, volume, issue, pages, publisher, place, publicationTitle, bookTitle, etc.',
              additionalProperties: { type: 'string' }
            },
            creators: {
              type: 'array',
              description: 'Creators for create action. Each: {creatorType, firstName, lastName} or {creatorType, name} for organizations.',
              items: {
                type: 'object',
                properties: {
                  creatorType: { type: 'string', description: 'author, editor, translator, contributor, etc.' },
                  firstName: { type: 'string' },
                  lastName: { type: 'string' },
                  name: { type: 'string', description: 'For organizations' }
                },
                required: ['creatorType']
              }
            },
            tags: {
              type: 'array',
              items: { type: 'string' },
              description: 'Tags to add to the new item'
            },
            attachmentKeys: {
              type: 'array',
              items: { type: 'string' },
              description: 'For create: existing standalone attachment keys to re-parent under the new item. For reparent: attachment keys to move.'
            },
            parentKey: {
              type: 'string',
              description: 'For reparent action: the target parent item key to move attachments to'
            },
            filePath: {
              type: 'string',
              description: 'For import action: absolute path to the file to import as an attachment'
            },
            parentItemKey: {
              type: 'string',
              description: 'For import action: Zotero item key of the parent to attach the file to'
            },
            title: {
              type: 'string',
              description: 'For import action: display title for the attachment (defaults to the file name)'
            }
          },
          required: ['action']
        }
      },
      {
        name: 'run_javascript',
        description: 'Execute arbitrary JavaScript inside the Zotero process (privileged context — same power as Tools → Developer → Run JavaScript). Full access to Zotero.Items/Collections/Tags and saveTx/eraseTx for automation beyond the structured tools. Requires "Run JavaScript" enabled in the plugin preferences. Returns {result, logs, error}. eraseTx is IRREVERSIBLE (no trash) — confirm with the user and read back after writes. Prefer a dedicated tool when one exists (search/write/collections). Long sweeps: pass timeout_ms.',
        inputSchema: {
          type: 'object',
          properties: {
            code: {
              type: 'string',
              description: 'JavaScript source. Injected globals: Zotero, ZoteroPane, ztoolkit, console. Top-level await is allowed (most Zotero.Items/Collections getters are async — await them). Use `return <value>` to return data (JSON-serialized). Example: return (await Zotero.Items.getAll(Zotero.Libraries.userLibraryID)).length'
            },
            timeout_ms: {
              type: 'number',
              description: 'Max execution time in ms (default 60000, max 600000). Raise for full-library sweeps.',
            },
          },
          required: ['code']
        }
      },
      {
        name: 'reload_plugin',
        description: 'Reload an installed Zotero plugin via AddonManager (dev loop). Omit addon_id to reload THIS MCP plugin itself — it replies first, then reloads after 500ms (connection drops briefly). Requires eval.enabled.',
        inputSchema: {
          type: 'object',
          properties: {
            addon_id: { type: 'string', description: 'Addon ID to reload. Optional; defaults to this plugin.' },
          },
        },
      },
      {
        name: 'install_plugin_from_url',
        description: 'Download and install/upgrade a plugin XPI from an http(s):// or file:// URL reachable FROM the Zotero machine (dev loop). Installing an XPI is arbitrary code execution — requires eval.enabled. Self-upgrade replies first, installs after 500ms.',
        inputSchema: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'XPI URL reachable FROM the Zotero machine.' },
            self_upgrade: {
              type: 'boolean',
              description: 'true (default): the XPI is THIS MCP plugin — install is deferred so the reply can flush before the server restarts. false: another plugin — installs inline and reports {installed, version}.',
            },
          },
          required: ['url'],
        },
      },
      {
        name: 'import_by_identifier',
        description: 'Import an item by DOI / arXiv ID / ISBN / PMID using Zotero\'s own translation engine. Idempotent by default (if_exists=skip searches the library first). Set fetch_pdf=true to also run Zotero\'s "Find Available PDF" (open-access resolver). Requires write.enabled. Example: {"identifier": "10.1145/3025453.3025599", "collectionKeys": "ABCD1234", "fetch_pdf": true}',
        inputSchema: {
          type: 'object',
          properties: {
            identifier: { type: 'string', description: 'Raw string containing a DOI, arXiv ID, ISBN, or PMID.' },
            libraryID: { type: 'number', description: 'Target library ID (default: user library).' },
            collectionKeys: { type: 'string', description: '8-char collection key(s), comma-separated or JSON array. Validated before import.' },
            tags: { type: 'string', description: 'Tag(s) to add, comma-separated or JSON array.' },
            if_exists: { type: 'string', enum: ['skip', 'duplicate'], description: 'skip (default): return the existing item; duplicate: import anyway.' },
            fetch_pdf: { type: 'boolean', description: 'Also try to attach an open-access PDF (default false).' },
          },
          required: ['identifier'],
        },
      },
      {
        name: 'find_missing_pdfs',
        description: 'Audit which regular items lack a PDF attachment (action=report, read-only), and optionally auto-fetch open-access PDFs via Zotero\'s built-in resolver (action=fetch, requires write.enabled, max 50 per call — loop for more). Example: {"action": "report", "collectionKey": "ABCD1234"} Download sources are Zotero\'s built-in OA resolvers plus any registered via manage_pdf_resolvers (e.g. Sci-Hub/Anna\'s Archive — must be added explicitly and are manual-only unless automatic is enabled). 若已启用 Sci-Hub（manage_pdf_resolvers action=enable），fetch 可能经灰色源下载并在返回 greySourceWarning 提醒。',
        inputSchema: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: ['report', 'fetch'], description: 'report (default) or fetch.' },
            collectionKey: { type: 'string', description: 'Limit scope to one collection (default: whole library).' },
            libraryID: { type: 'number' },
            limit: { type: 'number', description: 'report: max listed (default 100). fetch: max fetched per call (default 5, cap 50 — each fetch can take tens of seconds; keep batches small and loop).' },
          },
        },
      },
      {
        name: 'find_doi',
        description: 'Reverse-lookup a DOI for an item that lacks one, via CrossRef (OpenURL then REST title+author+year search, with title-similarity ≥0.86 matching). DRY-RUN by default: returns the best candidate + score without writing. Set confirm=true to write it into the DOI field (backs up any prior DOI into Extra). Requires write.enabled to confirm. Example: {"itemKey":"ABCD1234"}',
        inputSchema: {
          type: 'object',
          properties: {
            itemKey: { type: 'string' },
            libraryID: { type: 'number' },
            confirm: { type: 'boolean', description: 'false (default): return candidate only. true: write the matched DOI (write.enabled required).' },
          },
          required: ['itemKey'],
        },
      },
      {
        name: 'enrich_item_metadata',
        description: 'Fill missing metadata (abstract, venue, volume/issue/pages, ISSN, publisher, date) on an existing item from its DOI (doi.org CSL-JSON + OpenAlex for abstract). Only fills EMPTY fields; abstract replaced only if empty or <200 chars & incoming longer; creators replaced only in mode=replace when incoming is strictly longer with a shared surname. DRY-RUN by default (returns the patch); confirm=true writes (write.enabled required). No DOI → returns needsDoi (run find_doi first). Example: {"itemKey":"ABCD1234"}',
        inputSchema: {
          type: 'object',
          properties: {
            itemKey: { type: 'string' },
            libraryID: { type: 'number' },
            mode: { type: 'string', enum: ['fill', 'replace'], description: 'fill (default): only empty fields + abstract rule. replace: also allow creator-list replacement.' },
            confirm: { type: 'boolean', description: 'false (default): dry-run patch. true: write (write.enabled required).' },
          },
          required: ['itemKey'],
        },
      },
      {
        name: 'extract_identifier_from_pdf',
        description: 'Extract a DOI / arXiv id from an item\'s PDF fulltext cache (Zotero\'s already-indexed text — no re-parsing). Read-only. Useful for items that have a PDF but no identifier — feed the result into import_by_identifier or find_missing_pdfs. Returns the first attachment that yields an identifier (DOI picked by frequency vote to avoid reference-list false positives). Example: {"itemKey":"ABCD1234"}',
        inputSchema: {
          type: 'object',
          properties: {
            itemKey: { type: 'string', description: 'Regular item whose PDF attachments to scan.' },
            libraryID: { type: 'number' },
          },
          required: ['itemKey'],
        },
      },
      {
        name: 'manage_pdf_resolvers',
        description: 'Manage Zotero\'s custom PDF download resolvers (extensions.zotero.findPDFs.resolvers). Downloading is Zotero-native (see find_missing_pdfs action=fetch); this tool only registers WHERE to look. Grey sources (Sci-Hub, Anna\'s Archive) register with automatic=false — used ONLY on manual "Find Available PDF", never in auto-save flows. You are responsible for legal compliance in your jurisdiction. Requires write.enabled. Presets: scihub-se, scihub-st, scihub-ru, annas-scidb. Example: {"action":"add","preset":"scihub-se"}. enable/disable 切换 Sci-Hub 灰色源总开关（scihub.enabled）并同步源列表到 resolver pref。',
        inputSchema: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: ['list','add','remove','set_automatic','enable','disable'], description: 'list (read-only): show current + available presets. add: register a preset or custom resolver. remove: drop by name+url, or all MCP-managed if none given. set_automatic: toggle automatic flag — requires BOTH name and url (list first to get exact values). enable/disable: toggle Sci-Hub grey-source switch and sync to resolvers.' },
            preset: { type: 'string', description: 'Preset key for add (scihub-se/scihub-st/scihub-ru/annas-scidb).' },
            name: { type: 'string', description: 'Custom resolver display name (add without preset), or target name for remove/set_automatic.' },
            url: { type: 'string', description: 'Custom URL template containing {doi}, or target url for remove/set_automatic.' },
            selector: { type: 'string', description: 'Custom CSS selector to find the PDF link.' },
            attribute: { type: 'string', description: 'Custom HTML attribute holding the PDF URL (default src).' },
            automatic: { type: 'boolean', description: 'For add/set_automatic: true = also used in auto-save flows; false (default for grey sources) = manual-only.' },
          },
          required: ['action'],
        },
      },
      {
        name: 'check_retractions',
        description: 'Scan library/collection/tag items against scite.ai editorial notices (retractions, corrections, concerns). Read-only; sends the items\' DOIs to api.scite.ai (keyless public API). Items without a DOI are skipped and counted. Returns only flagged items. Expect an "unreachable" error when scite is slow — retry later. Example: {"collectionKey": "ABCD1234"}',
        inputSchema: {
          type: 'object',
          properties: {
            collectionKey: { type: 'string' },
            tag: { type: 'string' },
            itemKeys: { type: 'string', description: 'Comma-separated or JSON array of item keys.' },
            libraryID: { type: 'number' },
          },
        },
      },
      {
        name: 'find_related_papers',
        description: 'Walk the citation graph via api.openalex.org (keyless): direction=references lists what the seed paper cites; direction=citations (default) lists papers citing it, by citation count. Each result carries inLibrary — pipe missing ones into import_by_identifier. Sends the seed DOI to OpenAlex. Example: {"itemKey": "ABCD1234", "direction": "citations", "limit": 10}',
        inputSchema: {
          type: 'object',
          properties: {
            doi: { type: 'string' },
            itemKey: { type: 'string', description: 'Alternative to doi: an in-library item with a DOI.' },
            direction: { type: 'string', enum: ['references', 'citations'] },
            limit: { type: 'number', description: 'Max results (default 20, cap 50).' },
            libraryID: { type: 'number' },
          },
        },
      },
      {
        name: 'synthesize_annotations',
        description: 'Aggregate ALL highlights (+comments) and notes across a collection / tag / item set into one markdown bundle grouped by paper — raw material for literature-review synthesis. Read-only. Scope is required (whole-library would flood the context). Example: {"tag": "Gaze Estimation"}',
        inputSchema: {
          type: 'object',
          properties: {
            collectionKey: { type: 'string' },
            tag: { type: 'string' },
            itemKeys: { type: 'string', description: 'Comma-separated or JSON array.' },
            noteExcerptChars: { type: 'number', description: 'Note excerpt length (default 400, cap 2000).' },
            libraryID: { type: 'number' },
          },
        },
      },
      {
        name: 'find_duplicates',
        description: 'Detect duplicate item groups using Zotero\'s native duplicates engine. Returns groups with per-item metadata (dateAdded, attachment count) so you can choose a master. Requires write.enabled (its purpose is feeding merge_duplicates). Example: {}',
        inputSchema: {
          type: 'object',
          properties: {
            libraryID: { type: 'number' },
            limit: { type: 'number', description: 'Max groups returned (default 50).' },
          },
        },
      },
      {
        name: 'merge_duplicates',
        description: 'Merge one duplicate group into a master item via Zotero\'s native merge (keeps relations/tags/collections; losers go to TRASH, recoverable). DRY-RUN by default — returns the merge plan; re-call with confirm: true to execute. Requires write.enabled. Example: {"masterKey": "ABCD1234", "otherKeys": "EFGH5678", "confirm": false}',
        inputSchema: {
          type: 'object',
          properties: {
            masterKey: { type: 'string' },
            otherKeys: { type: 'string', description: 'Comma-separated or JSON array of item keys to merge into master.' },
            confirm: { type: 'boolean', description: 'false (default): dry-run plan only. true: execute.' },
            libraryID: { type: 'number' },
          },
          required: ['masterKey', 'otherKeys'],
        },
      },
      {
        name: 'batch_update_tags',
        description: 'Bulk tag operations. add/remove apply to a scope (collectionKey and/or tag filter, required); rename is library-global and uses Zotero.Tags.rename — associations preserved, same-name tags auto-merged (the ONLY safe way to merge tag case-variants; never delete+re-add). DRY-RUN by default; re-call with confirm: true. Requires write.enabled. Example: {"rename": {"from": "machine learning", "to": "Machine Learning"}, "confirm": true}',
        inputSchema: {
          type: 'object',
          properties: {
            scope: {
              type: 'object',
              properties: {
                collectionKey: { type: 'string' },
                tag: { type: 'string', description: 'Only items currently carrying this tag.' },
              },
            },
            add: { type: 'string', description: 'Tag(s) to add, comma-separated or JSON array.' },
            remove: { type: 'string', description: 'Tag(s) to remove, comma-separated or JSON array.' },
            rename: {
              type: 'object',
              properties: { from: { type: 'string' }, to: { type: 'string' } },
            },
            confirm: { type: 'boolean', description: 'false (default): dry-run. true: execute.' },
            libraryID: { type: 'number' },
          },
        },
      },
    ];

    // Filter out semantic tools if semantic search is disabled
    const semanticEnabled = Zotero.Prefs.get('extensions.zotero.zotero-mcp-plugin.semantic.enabled', true);
    const semanticToolNames = new Set(['semantic_search', 'find_similar', 'semantic_status']);
    const filteredTools = semanticEnabled === false
      ? tools.filter((t: any) => !semanticToolNames.has(t.name))
      : tools;

    // Filter out write tools if write operations are disabled (default: disabled)
    const writeEnabled = Zotero.Prefs.get('extensions.zotero.zotero-mcp-plugin.write.enabled', true);
    const writeToolNames = new Set([
      'write_note', 'write_tag', 'write_metadata', 'write_item',
      'create_collection', 'update_collection', 'delete_collection',
      'add_items_to_collection', 'remove_items_from_collection',
      'import_by_identifier',
      'find_duplicates', 'merge_duplicates',
      'batch_update_tags',
    ]);
    let finalTools = writeEnabled === true
      ? filteredTools
      : filteredTools.filter((t: any) => !writeToolNames.has(t.name));

    // Filter out eval-gated tools when eval is disabled (default: disabled)
    const evalEnabled = Zotero.Prefs.get('extensions.zotero.zotero-mcp-plugin.eval.enabled', true);
    const evalToolNames = new Set(['run_javascript', 'reload_plugin', 'install_plugin_from_url']);
    if (evalEnabled !== true) {
      finalTools = finalTools.filter((t: any) => !evalToolNames.has(t.name));
    }

    return this.createResponse(request.id ?? null, { tools: finalTools });
  }

  private async handleToolCall(request: MCPRequest): Promise<MCPResponse> {
    const { name, arguments: args } = request.params;
    
    try {
      let result;
      
      switch (name) {
        case 'get_libraries':
          result = await this.callGetLibraries(args);
          break;

        case 'search_libraries':
          if (!args?.q) {
            throw new Error('q is required');
          }
          result = await this.callSearchLibraries(args);
          break;

        case 'search_library':
          result = await this.callSearchLibrary(args);
          break;

        case 'search_annotations':
          // q is optional when colors or tags filters are provided
          if (!args?.q && !args?.colors && !args?.tags) {
            throw new Error('Either q (query), colors, or tags filter is required');
          }
          result = await this.callSearchAnnotations(args);
          break;

        case 'get_item_details':
          if (!args?.itemKey) {
            throw new Error('itemKey is required');
          }
          result = await this.callGetItemDetails(args);
          break;

        case 'get_annotations':
          if (!args?.itemKey && !args?.annotationId && !args?.annotationIds) {
            throw new Error('Either itemKey, annotationId, or annotationIds is required');
          }
          result = await this.callGetAnnotations(args);
          break;

        case 'get_content':
          if (!args?.itemKey && !args?.attachmentKey) {
            throw new Error('Either itemKey or attachmentKey is required');
          }
          result = await this.callGetContent(args);
          break;

        case 'get_collections':
          result = await this.callGetCollections(args);
          break;

        case 'search_collections':
          result = await this.callSearchCollections(args);
          break;

        case 'get_collection_details':
          if (!args?.collectionKey) {
            throw new Error('collectionKey is required');
          }
          result = await this.callGetCollectionDetails(args);
          break;

        case 'get_collection_items':
          if (!args?.collectionKey) {
            throw new Error('collectionKey is required');
          }
          result = await this.callGetCollectionItems(args);
          break;

        case 'get_subcollections':
          if (!args?.collectionKey) {
            throw new Error('collectionKey is required');
          }
          result = await this.callGetSubcollections(args);
          break;

        case 'create_collection': {
          const writeEnabledCC = Zotero.Prefs.get('extensions.zotero.zotero-mcp-plugin.write.enabled', true);
          if (writeEnabledCC !== true) {
            throw new Error('Write operations are currently disabled. Please go to Zotero → Tools → Add-ons → Zotero MCP Plugin → Preferences, and enable "Write Operations" to use this feature.');
          }
          if (!args?.name) {
            throw new Error('name is required');
          }
          result = await this.callCreateCollection(args);
          break;
        }

        case 'update_collection': {
          const writeEnabledUC = Zotero.Prefs.get('extensions.zotero.zotero-mcp-plugin.write.enabled', true);
          if (writeEnabledUC !== true) {
            throw new Error('Write operations are currently disabled. Please go to Zotero → Tools → Add-ons → Zotero MCP Plugin → Preferences, and enable "Write Operations" to use this feature.');
          }
          if (!args?.collectionKey) {
            throw new Error('collectionKey is required');
          }
          result = await this.callUpdateCollection(args);
          break;
        }

        case 'delete_collection': {
          const writeEnabledDC = Zotero.Prefs.get('extensions.zotero.zotero-mcp-plugin.write.enabled', true);
          if (writeEnabledDC !== true) {
            throw new Error('Write operations are currently disabled. Please go to Zotero → Tools → Add-ons → Zotero MCP Plugin → Preferences, and enable "Write Operations" to use this feature.');
          }
          if (!args?.collectionKey) {
            throw new Error('collectionKey is required');
          }
          result = await this.callDeleteCollection(args);
          break;
        }

        case 'add_items_to_collection': {
          const writeEnabledAI = Zotero.Prefs.get('extensions.zotero.zotero-mcp-plugin.write.enabled', true);
          if (writeEnabledAI !== true) {
            throw new Error('Write operations are currently disabled. Please go to Zotero → Tools → Add-ons → Zotero MCP Plugin → Preferences, and enable "Write Operations" to use this feature.');
          }
          if (!args?.collectionKey) {
            throw new Error('collectionKey is required');
          }
          const addKeys = this.coerceStringArray(args?.itemKeys);
          if (!addKeys || addKeys.length === 0) {
            throw new Error(`itemKeys array is required, e.g. ["ABCD1234"]. Received: ${JSON.stringify(args?.itemKeys)}`);
          }
          result = await this.callAddItemsToCollection({ ...args, itemKeys: addKeys });
          break;
        }

        case 'remove_items_from_collection': {
          const writeEnabledRI = Zotero.Prefs.get('extensions.zotero.zotero-mcp-plugin.write.enabled', true);
          if (writeEnabledRI !== true) {
            throw new Error('Write operations are currently disabled. Please go to Zotero → Tools → Add-ons → Zotero MCP Plugin → Preferences, and enable "Write Operations" to use this feature.');
          }
          if (!args?.collectionKey) {
            throw new Error('collectionKey is required');
          }
          const removeKeys = this.coerceStringArray(args?.itemKeys);
          if (!removeKeys || removeKeys.length === 0) {
            throw new Error(`itemKeys array is required, e.g. ["ABCD1234"]. Received: ${JSON.stringify(args?.itemKeys)}`);
          }
          result = await this.callRemoveItemsFromCollection({ ...args, itemKeys: removeKeys });
          break;
        }

        case 'search_fulltext':
          if (!args?.q) {
            throw new Error('q (query) is required');
          }
          result = await this.callSearchFulltext(args);
          break;

        case 'get_item_abstract':
          if (!args?.itemKey) {
            throw new Error('itemKey is required');
          }
          result = await this.callGetItemAbstract(args);
          break;

        // Semantic Search Tools
        case 'semantic_search':
        case 'find_similar':
        case 'semantic_status': {
          const semEnabled = Zotero.Prefs.get('extensions.zotero.zotero-mcp-plugin.semantic.enabled', true);
          if (semEnabled === false) {
            throw new Error('Semantic search is disabled. Enable it in Zotero MCP Plugin preferences.');
          }
          if (name === 'semantic_search') {
            if (!args?.query) throw new Error('query is required');
            result = await this.callSemanticSearch(args);
          } else if (name === 'find_similar') {
            if (!args?.itemKey) throw new Error('itemKey is required');
            result = await this.callFindSimilar(args);
          } else {
            result = await this.callSemanticStatus();
          }
          break;
        }

        case 'fulltext_database':
          if (!args?.action) {
            throw new Error('action is required');
          }
          result = await this.callFulltextDatabase(args);
          break;

        // Write Tools
        case 'write_note': {
          const writeEnabled = Zotero.Prefs.get('extensions.zotero.zotero-mcp-plugin.write.enabled', true);
          if (writeEnabled !== true) {
            throw new Error('Write operations are currently disabled. Please go to Zotero → Tools → Add-ons → Zotero MCP Plugin → Preferences, and enable "Write Operations" to use this feature.');
          }
          if (!args?.action || !args?.content) {
            throw new Error('action and content are required');
          }
          result = await this.callWriteNote(args);
          break;
        }

        case 'write_tag': {
          const writeEnabled2 = Zotero.Prefs.get('extensions.zotero.zotero-mcp-plugin.write.enabled', true);
          if (writeEnabled2 !== true) {
            throw new Error('Write operations are currently disabled. Please go to Zotero → Tools → Add-ons → Zotero MCP Plugin → Preferences, and enable "Write Operations" to use this feature.');
          }
          if (!args?.action || !args?.itemKey || !args?.tags) {
            throw new Error('action, itemKey, and tags are required');
          }
          result = await this.callWriteTag(args);
          break;
        }

        case 'write_metadata': {
          const writeEnabled3 = Zotero.Prefs.get('extensions.zotero.zotero-mcp-plugin.write.enabled', true);
          if (writeEnabled3 !== true) {
            throw new Error('Write operations are currently disabled. Please go to Zotero → Tools → Add-ons → Zotero MCP Plugin → Preferences, and enable "Write Operations" to use this feature.');
          }
          if (!args?.itemKey) {
            throw new Error('itemKey is required');
          }
          if (!args?.fields && !args?.creators) {
            throw new Error('At least one of fields or creators is required');
          }
          result = await this.callWriteMetadata(args);
          break;
        }

        case 'write_item': {
          const writeEnabled4 = Zotero.Prefs.get('extensions.zotero.zotero-mcp-plugin.write.enabled', true);
          if (writeEnabled4 !== true) {
            throw new Error('Write operations are currently disabled. Please go to Zotero → Tools → Add-ons → Zotero MCP Plugin → Preferences, and enable "Write Operations" to use this feature.');
          }
          if (!args?.action) {
            throw new Error('action is required');
          }
          result = await this.callWriteItem(args);
          break;
        }

        case 'run_javascript': {
          const evalEnabled = Zotero.Prefs.get('extensions.zotero.zotero-mcp-plugin.eval.enabled', true);
          if (evalEnabled !== true) {
            throw new Error('JavaScript execution is disabled. Enable "Run JavaScript (eval)" in the plugin preferences to use this tool.');
          }
          if (!args?.code || typeof args.code !== 'string') {
            throw new Error('code (string) is required');
          }
          const pane =
            ((globalThis as any).ZoteroPane) ||
            (Zotero.getActiveZoteroPane ? Zotero.getActiveZoteroPane() : undefined);
          result = await runUserJavaScript(args.code, { Zotero, ZoteroPane: pane, ztoolkit }, args.timeout_ms);
          break;
        }

        case 'reload_plugin': {
          const evalEnabledRP = Zotero.Prefs.get('extensions.zotero.zotero-mcp-plugin.eval.enabled', true);
          if (evalEnabledRP !== true) {
            throw new Error("Dev tools are disabled. Enable 'Run JavaScript' in Zotero Settings → MCP Server.");
          }
          result = await reloadPlugin(args?.addon_id, config.addonID);
          break;
        }

        case 'install_plugin_from_url': {
          const evalEnabledIP = Zotero.Prefs.get('extensions.zotero.zotero-mcp-plugin.eval.enabled', true);
          if (evalEnabledIP !== true) {
            throw new Error("Dev tools are disabled. Enable 'Run JavaScript' in Zotero Settings → MCP Server.");
          }
          if (!args?.url) {
            throw new Error('url is required');
          }
          result = await installPluginFromUrl(args.url, args?.self_upgrade !== false);
          break;
        }

        case 'import_by_identifier': {
          const writeEnabledIB = Zotero.Prefs.get('extensions.zotero.zotero-mcp-plugin.write.enabled', true);
          if (writeEnabledIB !== true) {
            throw new Error('Write operations are currently disabled. Please go to Zotero → Tools → Add-ons → Zotero MCP Plugin → Preferences, and enable "Write Operations" to use this feature.');
          }
          if (!args?.identifier) {
            throw new Error('identifier is required');
          }
          result = await importByIdentifier({
            ...args,
            libraryID: args?.libraryID ?? Zotero.Libraries.userLibraryID,
          });
          break;
        }

        case 'find_missing_pdfs': {
          if (args?.action === 'fetch') {
            const writeEnabledFMP = Zotero.Prefs.get('extensions.zotero.zotero-mcp-plugin.write.enabled', true);
            if (writeEnabledFMP !== true) {
              throw new Error('Write operations are currently disabled. Please go to Zotero → Tools → Add-ons → Zotero MCP Plugin → Preferences, and enable "Write Operations" to use this feature.');
            }
            const fetchResult = await findMissingPdfs({
              ...args,
              libraryID: args?.libraryID ?? Zotero.Libraries.userLibraryID,
            });
            const scihubOn = Zotero.Prefs.get('extensions.zotero.zotero-mcp-plugin.scihub.enabled', true) === true;
            if (scihubOn) {
              (fetchResult as any).greySourceWarning = "⚠️ 已启用 Sci-Hub / Anna's Archive 灰色源，下载可能来自这些源，请确认合规";
            }
            try {
              const win = ((globalThis as any).ZoteroPane?.document?.defaultView) || (Zotero.getMainWindow && Zotero.getMainWindow());
              if (win) {
                const pw = new (Zotero as any).ProgressWindow({ closeOnClick: true });
                pw.changeHeadline('Zotero MCP');
                pw.addDescription(`查找全文完成：下载 ${(fetchResult as any).fetched ?? 0} 篇${scihubOn ? '（含灰色源）' : ''}`);
                pw.show();
                pw.startCloseTimer(3000);
              }
            } catch (e) { /* 提示窗尽力而为 */ }
            result = fetchResult;
          } else {
            result = await findMissingPdfs({
              ...args,
              libraryID: args?.libraryID ?? Zotero.Libraries.userLibraryID,
            });
          }
          break;
        }

        case 'extract_identifier_from_pdf': {
          const libID = args?.libraryID ?? Zotero.Libraries.userLibraryID;
          const itemID = Zotero.Items.getIDFromLibraryAndKey(libID, args?.itemKey);
          if (!itemID) throw new Error(`Item not found: ${args?.itemKey}`);
          const item = await Zotero.Items.getAsync(itemID);
          const attIDs: number[] = item.getAttachments ? item.getAttachments() : [];
          const scanned: any[] = [];
          let hit: any = null;
          for (const aid of attIDs) {
            const att = Zotero.Items.get(aid);
            if (!att || att.attachmentContentType !== 'application/pdf') continue;
            let text = '';
            try {
              // ponytail: getContentsAsync takes the cache-file object per ZotMeta; if on-device
              // selfTest shows it needs .path instead, swap here — one-line follow-up.
              const cf = (Zotero.Fulltext as any).getItemCacheFile(att);
              const exists = cf && typeof cf.exists === 'function' ? cf.exists() : false;
              if (exists) text = String(await Zotero.File.getContentsAsync(cf));
            } catch (e: any) {
              scanned.push({ attachmentKey: att.key, error: e?.message ?? String(e) });
              continue;
            }
            const ids = extractIdentifiers(text);
            scanned.push({ attachmentKey: att.key, cacheChars: text.length, doi: ids.doi, arxiv: ids.arxiv });
            if (ids.doi || ids.arxiv) { hit = { attachmentKey: att.key, ...ids }; break; }
          }
          result = hit
            ? { found: true, ...hit, scanned }
            : { found: false, reason: attIDs.length ? 'no identifier in any PDF fulltext cache (is fulltext indexed?)' : 'item has no PDF attachments', scanned };
          break;
        }

        case 'manage_pdf_resolvers': {
          const PREF_KEY = 'extensions.zotero.findPDFs.resolvers';
          const readAll = () => parseResolvers(Zotero.Prefs.get(PREF_KEY, true));
          const act = args?.action;
          if (act === 'list') {
            const all = readAll();
            const scihubEnabled = Zotero.Prefs.get('extensions.zotero.zotero-mcp-plugin.scihub.enabled', true) === true;
            result = { resolvers: all, mcpManaged: all.filter((r: any) => r?.mcpManaged), presets: Object.keys(RESOLVER_PRESETS), scihubEnabled };
            break;
          }
          // write-gated actions
          if (Zotero.Prefs.get('extensions.zotero.zotero-mcp-plugin.write.enabled', true) !== true) {
            throw new Error('Write operations are currently disabled. Please go to Zotero → Tools → Add-ons → Zotero MCP Plugin → Preferences, and enable "Write Operations" to use this feature.');
          }
          if (act === 'enable' || act === 'disable') {
            const enabled = act === 'enable';
            Zotero.Prefs.set('extensions.zotero.zotero-mcp-plugin.scihub.enabled', enabled, true);
            const srcRaw = Zotero.Prefs.get('extensions.zotero.zotero-mcp-plugin.scihub.sources', true);
            let sources = parseSources(srcRaw);
            if (!sources.length) { sources = DEFAULT_SCIHUB_SOURCES; Zotero.Prefs.set('extensions.zotero.zotero-mcp-plugin.scihub.sources', JSON.stringify(sources), true); }
            const next = syncScihubResolvers(enabled, sources, Zotero.Prefs.get(PREF_KEY, true));
            Zotero.Prefs.set(PREF_KEY, JSON.stringify(next), true);
            result = { scihubEnabled: enabled, sourceCount: sources.length, greySourceWarning: enabled ? "⚠️ Sci-Hub / Anna's Archive 是灰色源，请确认你所在辖区的合规性" : undefined };
            break;
          }
          const existing = readAll();
          const mineNow = existing.filter((r: any) => r?.mcpManaged);
          if (act === 'add') {
            const r = buildResolver({ preset: args?.preset, name: args?.name, url: args?.url, selector: args?.selector, attribute: args?.attribute, automatic: args?.automatic });
            const nextMine = [...mineNow.filter((m: any) => !(m.name === r.name && m.url === r.url)), r];
            Zotero.Prefs.set(PREF_KEY, JSON.stringify(mergeResolvers(existing, nextMine)), true);
            result = { added: { name: r.name, url: r.url, automatic: r.automatic }, mcpManagedCount: nextMine.length };
          } else if (act === 'remove') {
            let nextMine;
            if (args?.name || args?.url) {
              nextMine = mineNow.filter((m: any) => !((!args?.name || m.name === args.name) && (!args?.url || m.url === args.url)));
            } else {
              nextMine = [];
            }
            Zotero.Prefs.set(PREF_KEY, JSON.stringify(mergeResolvers(existing, nextMine)), true);
            result = { removed: mineNow.length - nextMine.length, mcpManagedCount: nextMine.length };
          } else if (act === 'set_automatic') {
            let matched = 0;
            const nextMine = mineNow.map((m: any) => {
              if (m.name === args?.name && m.url === args?.url) { matched++; return { ...m, automatic: args?.automatic === true }; }
              return m;
            });
            if (!matched) { result = { error: `No MCP-managed resolver matched name+url. set_automatic requires BOTH name and url (list them first).`, updated: 0 }; break; }
            Zotero.Prefs.set(PREF_KEY, JSON.stringify(mergeResolvers(existing, nextMine)), true);
            result = { updated: matched, name: args?.name, automatic: args?.automatic === true };
          } else {
            throw new Error(`Unknown action: ${act}`);
          }
          break;
        }

        case 'check_retractions': {
          result = await checkRetractions({
            ...args,
            itemKeys: normalizeStringList(args?.itemKeys),
            libraryID: args?.libraryID ?? Zotero.Libraries.userLibraryID,
          });
          break;
        }

        case 'find_related_papers': {
          result = await findRelatedPapers({
            ...args,
            libraryID: args?.libraryID ?? Zotero.Libraries.userLibraryID,
          });
          break;
        }

        case 'synthesize_annotations': {
          result = await synthesizeAnnotations({
            ...args,
            itemKeys: normalizeStringList(args?.itemKeys),
            libraryID: args?.libraryID ?? Zotero.Libraries.userLibraryID,
          });
          break;
        }

        case 'find_duplicates': {
          const writeEnabledFD = Zotero.Prefs.get('extensions.zotero.zotero-mcp-plugin.write.enabled', true);
          if (writeEnabledFD !== true) {
            throw new Error('Write operations are currently disabled. Please go to Zotero → Tools → Add-ons → Zotero MCP Plugin → Preferences, and enable "Write Operations" to use this feature.');
          }
          result = await findDuplicates(args?.libraryID ?? Zotero.Libraries.userLibraryID, args?.limit);
          break;
        }

        case 'merge_duplicates': {
          const writeEnabledMD = Zotero.Prefs.get('extensions.zotero.zotero-mcp-plugin.write.enabled', true);
          if (writeEnabledMD !== true) {
            throw new Error('Write operations are currently disabled. Please go to Zotero → Tools → Add-ons → Zotero MCP Plugin → Preferences, and enable "Write Operations" to use this feature.');
          }
          if (!args?.masterKey) throw new Error('masterKey is required');
          const otherKeys = normalizeStringList(args?.otherKeys);
          if (!otherKeys.length) throw new Error('otherKeys is required');
          result = await mergeDuplicates({
            libraryID: args?.libraryID ?? Zotero.Libraries.userLibraryID,
            masterKey: args.masterKey,
            otherKeys,
            confirm: args?.confirm === true,
          });
          break;
        }

        case 'batch_update_tags': {
          const writeEnabledBUT = Zotero.Prefs.get('extensions.zotero.zotero-mcp-plugin.write.enabled', true);
          if (writeEnabledBUT !== true) {
            throw new Error('Write operations are currently disabled. Please go to Zotero → Tools → Add-ons → Zotero MCP Plugin → Preferences, and enable "Write Operations" to use this feature.');
          }
          let scope = args?.scope;
          if (typeof scope === 'string') {
            try { scope = JSON.parse(scope); } catch { throw new Error('scope must be an object like {"collectionKey": "..."} '); }
          }
          let rename = args?.rename;
          if (typeof rename === 'string') {
            try { rename = JSON.parse(rename); } catch { throw new Error('rename must be an object like {"from": "...", "to": "..."}'); }
          }
          result = await batchUpdateTags({
            libraryID: args?.libraryID ?? Zotero.Libraries.userLibraryID,
            scope,
            add: normalizeStringList(args?.add),
            remove: normalizeStringList(args?.remove),
            rename,
            confirm: args?.confirm === true,
          });
          break;
        }

        case 'find_doi': {
          if (!args?.itemKey) throw new Error('itemKey is required');
          const libIDFD = args?.libraryID ?? Zotero.Libraries.userLibraryID;
          const itemIDFD = Zotero.Items.getIDFromLibraryAndKey(libIDFD, args.itemKey);
          if (!itemIDFD) throw new Error(`Item not found: ${args.itemKey}`);
          const itemFD = await Zotero.Items.getAsync(itemIDFD);

          // Skip if item already has a DOI
          const existingDoiFD = String(itemFD.getField('DOI') ?? '').trim();
          if (existingDoiFD) { result = { alreadyHasDoi: existingDoiFD }; break; }

          const titleFD = String(itemFD.getField('title') ?? '').trim();
          if (!titleFD) throw new Error('Item has no title');

          const creatorsFD: any[] = itemFD.getCreators ? itemFD.getCreators() : [];
          const firstAuthorLastNameFD: string = creatorsFD[0]?.lastName ?? '';
          const rawDateFD = String(itemFD.getField('date') ?? '');
          const yearFD = (rawDateFD.match(/\d{4}/) ?? [])[0] ?? '';

          // ponytail: prefer Zotero.Utilities.cleanDOI if available; local fallback
          const cleanDoiFD = (d: string): string => {
            if (!d) return '';
            const utils = Zotero.Utilities as any;
            if (typeof utils.cleanDOI === 'function') return utils.cleanDOI(String(d));
            return String(d).replace(/^\s*doi:\s*/i, '').replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').trim();
          };

          // ---------- Tier 1: CrossRef OpenURL ----------
          let openUrlDoiFD: string | null = null;
          const openURL = (Zotero as any).OpenURL;
          if (openURL?.createContextObject) {
            const ctx = openURL.createContextObject(itemFD, '1.0');
            if (ctx) {
              const ouUrl = `https://www.crossref.org/openurl?pid=zotero-mcp-plugin&${ctx}&multihit=true`;
              let ouResp: any;
              try {
                ouResp = await Zotero.HTTP.request('GET', ouUrl, {
                  headers: { 'User-Agent': 'Zotero MCP Plugin' },
                  responseType: 'text',
                  timeout: 20000,
                } as any);
              } catch (e: any) {
                throw new Error(`CrossRef OpenURL unreachable — try again later. (${e?.message ?? e})`);
              }
              const mainWin = (Zotero as any).getMainWindow?.();
              const DPCtor = mainWin?.DOMParser ?? (typeof DOMParser !== 'undefined' ? DOMParser : null);
              if (DPCtor) {
                const xml = new DPCtor().parseFromString(String(ouResp.response ?? ''), 'application/xml');
                const query = xml.getElementsByTagName('query')[0];
                if (query && query.getAttribute('status') === 'resolved') {
                  const doiNode = query.getElementsByTagName('doi')[0];
                  const raw = cleanDoiFD(doiNode?.textContent ?? '');
                  if (raw) openUrlDoiFD = raw;
                }
                // multiresolved → openUrlDoiFD stays null, falls through to REST
              }
            }
          }

          // ---------- Tier 2: CrossRef REST with year double-probe ----------
          let bestRestFD: { doi: string; score: number; matchedTitle: string; via: string } | null = null;
          const restCandidatesFD: Array<{ doi: string; title: string; score: number }> = [];

          if (!openUrlDoiFD) {
            const restSearchFD = async (withYear: boolean): Promise<Array<{ doi: string; title: string; score: number }>> => {
              const params = new URLSearchParams({
                'query.title': titleFD,
                rows: '5',
                select: 'DOI,title,author,issued',
              });
              if (firstAuthorLastNameFD) params.set('query.author', firstAuthorLastNameFD);
              if (withYear && yearFD) params.set('filter', `from-pub-date:${yearFD},until-pub-date:${yearFD}`);
              let restResp: any;
              try {
                restResp = await Zotero.HTTP.request('GET', `https://api.crossref.org/works?${params.toString()}`, {
                  headers: { 'User-Agent': 'Zotero MCP Plugin' },
                  responseType: 'json',
                  timeout: 20000,
                } as any);
              } catch (e: any) {
                throw new Error(`CrossRef REST unreachable — try again later. (${e?.message ?? e})`);
              }
              const citems = (restResp.response as any)?.message?.items ?? [];
              return (citems as any[]).map((ci: any) => ({
                doi: cleanDoiFD(String(ci.DOI ?? '')),
                title: String(ci.title?.[0] ?? ''),
                score: titleSimilarity(titleFD, String(ci.title?.[0] ?? '')),
              }));
            };

            const probesFD = yearFD ? [true, false] : [false];
            for (const withYear of probesFD) {
              const probeItems = await restSearchFD(withYear);
              for (const c of probeItems) restCandidatesFD.push(c);
              const probeBest = probeItems.reduce<{ doi: string; title: string; score: number } | null>(
                (acc, c) => (!acc || c.score > acc.score ? c : acc), null,
              );
              if (probeBest && probeBest.score >= MATCH_THRESHOLD) {
                bestRestFD = { doi: probeBest.doi, score: probeBest.score, matchedTitle: probeBest.title, via: withYear ? 'crossref-rest-year' : 'crossref-rest' };
                break;
              }
            }
          }

          // ---------- Decide ----------
          if (!openUrlDoiFD && !bestRestFD) {
            const top3 = [...restCandidatesFD]
              .sort((a, b) => b.score - a.score)
              .filter((c, i, arr) => arr.findIndex(x => x.doi === c.doi) === i)
              .slice(0, 3);
            result = { found: false, bestScore: top3[0]?.score ?? 0, candidates: top3.map(c => ({ doi: c.doi, title: c.title, score: c.score })) };
            break;
          }

          const foundDoiFD = openUrlDoiFD ?? bestRestFD!.doi;
          const foundScoreFD = openUrlDoiFD ? 1 : bestRestFD!.score;
          const foundMatchedTitleFD = openUrlDoiFD ? titleFD : bestRestFD!.matchedTitle;
          const foundViaFD = openUrlDoiFD ? 'crossref-openurl' : bestRestFD!.via;

          if (!args?.confirm) {
            result = { found: true, doi: foundDoiFD, score: foundScoreFD, matchedTitle: foundMatchedTitleFD, via: foundViaFD, dryRun: true, confirmWith: 'confirm:true' };
            break;
          }

          // ---------- Write gate (confirm=true) ----------
          const writeEnabledFDI = Zotero.Prefs.get('extensions.zotero.zotero-mcp-plugin.write.enabled', true);
          if (writeEnabledFDI !== true) {
            throw new Error('Write operations are currently disabled. Please go to Zotero → Tools → Add-ons → Zotero MCP Plugin → Preferences, and enable "Write Operations" to use this feature.');
          }

          // Write to DOI field if supported, else append to Extra
          const itemFieldsFD = Zotero.ItemFields as any;
          const doiFieldID = itemFieldsFD.getID?.('DOI');
          if (doiFieldID && itemFieldsFD.isValidForType?.(doiFieldID, itemFD.itemTypeID)) {
            itemFD.setField('DOI', foundDoiFD);
          } else {
            const extraFD2 = String(itemFD.getField('extra') ?? '');
            itemFD.setField('extra', extraFD2 ? `${extraFD2}\nDOI: ${foundDoiFD}` : `DOI: ${foundDoiFD}`);
          }

          await itemFD.saveTx();

          // Verify write
          const rereadFD = await Zotero.Items.getAsync(itemIDFD);
          const writtenDoi = String(rereadFD.getField('DOI') ?? '').trim()
            || (String(rereadFD.getField('extra') ?? '').match(/^\s*DOI:\s*(.+)$/im)?.[1]?.trim() ?? '');

          result = { written: true, doi: foundDoiFD, verified: writtenDoi === foundDoiFD, itemKey: args.itemKey };
          break;
        }

        case 'enrich_item_metadata': {
          const libID = args?.libraryID ?? Zotero.Libraries.userLibraryID;
          const itemID = Zotero.Items.getIDFromLibraryAndKey(libID, args?.itemKey);
          if (!itemID) throw new Error(`Item not found: ${args?.itemKey}`);
          const item = await Zotero.Items.getAsync(itemID);
          const doi = String(item.getField('DOI') || '').trim();
          if (!doi) { result = { needsDoi: true, hint: 'Item has no DOI. Run find_doi first, then enrich.' }; break; }

          // 1) canonical record via doi.org CSL-JSON
          let csl: any;
          try {
            const r = await Zotero.HTTP.request('GET', `https://doi.org/${encodeURIComponent(doi)}`, { headers: { Accept: 'application/vnd.citationstyles.csl+json' }, responseType: 'json', timeout: 20000 } as any);
            csl = r.response;
          } catch (e: any) { throw new Error(`doi.org lookup failed for ${doi} (${e?.message ?? e}) — try again later`); }
          const incoming = cslToZoteroFields(csl);

          // 2) abstract fallback via OpenAlex if CSL lacked it
          if (!incoming.abstractNote) {
            try {
              const r = await Zotero.HTTP.request('GET', `https://api.openalex.org/works/doi:${encodeURIComponent(doi)}`, { responseType: 'json', timeout: 20000 } as any);
              const abs = reconstructAbstract((r.response as any)?.abstract_inverted_index);
              if (abs) incoming.abstractNote = abs;
            } catch { /* abstract is best-effort */ }
          }

          // 3) snapshot existing scalar fields the patch cares about
          const existing: Record<string, any> = { abstractNote: item.getField('abstractNote') || '', date: item.getField('date') || '' };
          for (const f of FILL_MISSING_FIELDS) { try { existing[f] = item.getField(f) || ''; } catch { existing[f] = ''; } }
          const patch = computeEnrichPatch(existing, incoming);

          // 4) creators (mode=replace only)
          let creatorPatch: any = null;
          if (args?.mode === 'replace' && incoming.creators?.length) {
            const existingCreators = item.getCreators ? item.getCreators() : [];
            if (shouldReplaceCreators(existingCreators, incoming.creators)) creatorPatch = incoming.creators;
          }

          // Resolve each patch field to a field ID valid for THIS item type (base→type mapping,
          // e.g. publicationTitle→proceedingsTitle for conferencePaper). Done once so dry-run
          // preview matches what confirm actually writes.
          // ponytail: getFieldIDFromTypeAndBase existence is verified on-device;
          //   the ?. guard degrades gracefully — field is skipped rather than throwing if absent.
          const IF = Zotero.ItemFields as any;
          const resolveFid = (f: string): number | null => {
            const base = IF.getID(f);
            if (!base) return null;
            if (IF.isValidForType(base, item.itemTypeID)) return base;
            const mapped = IF.getFieldIDFromTypeAndBase ? IF.getFieldIDFromTypeAndBase(item.itemTypeID, base) : null;
            return mapped && IF.isValidForType(mapped, item.itemTypeID) ? mapped : null;
          };
          const resolvedFields: Array<{ field: string; fid: number; value: any }> = [];
          const skippedForType: string[] = [];
          for (const [f, v] of Object.entries(patch)) {
            const fid = resolveFid(f);
            if (fid) resolvedFields.push({ field: f, fid, value: v });
            else skippedForType.push(f);
          }

          if (args?.confirm !== true) {
            result = {
              dryRun: true,
              itemKey: item.key,
              patch: Object.fromEntries(resolvedFields.map((r) => [r.field, r.value])),
              skippedForType,
              creatorsWouldReplace: !!creatorPatch,
              confirmWith: 'confirm:true',
            };
            break;
          }
          // write-gated
          if (Zotero.Prefs.get('extensions.zotero.zotero-mcp-plugin.write.enabled', true) !== true) {
            throw new Error('Write operations are currently disabled. Please go to Zotero → Tools → Add-ons → Zotero MCP Plugin → Preferences, and enable "Write Operations" to use this feature.');
          }
          const applied: string[] = [];
          for (const r of resolvedFields) {
            try { item.setField(r.fid, r.value); applied.push(r.field); } catch { /* skip */ }
          }
          if (creatorPatch) { item.setCreators(creatorPatch); applied.push('creators'); }
          if (!applied.length) { result = { enriched: false, reason: 'nothing to fill — record had no new data (or all fields invalid for this item type)', itemKey: item.key, skippedForType }; break; }
          await item.saveTx();
          const reread = await Zotero.Items.getAsync(itemID);
          result = { enriched: true, applied, skippedForType, itemKey: reread.key, abstractLen: (reread.getField('abstractNote') || '').length };
          break;
        }

        default:
          return this.createError(request.id ?? null, -32602, `Unknown tool: ${name}`);
      }

      // Wrap result in MCP content format with proper text type.
      // Keep large results compact: the HTTP layer writes the body in a
      // single synchronous call, so avoid inflating multi-MB payloads.
      const compactJson = JSON.stringify(result);
      return this.createResponse(request.id ?? null, {
        content: [
          {
            type: "text",
            text: compactJson.length > 100000 ? compactJson : JSON.stringify(result, null, 2)
          }
        ]
      });

    } catch (error) {
      ztoolkit.log(`[StreamableMCP] Tool call error for ${name}: ${error}`);
      // MCP spec: execution failures are results (isError), not protocol errors —
      // clients surface them to the LLM instead of treating the transport as broken.
      return this.createResponse(request.id ?? null, {
        content: [
          {
            type: "text",
            text: `Error executing ${name}: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      });
    }
  }

  private async callGetLibraries(args: any): Promise<any> {
    const queryParams = new URLSearchParams();
    for (const [key, value] of Object.entries(args || {})) {
      if (value !== undefined && value !== null) {
        queryParams.append(key, String(value));
      }
    }

    const response = await handleGetLibraries(queryParams);
    const result = response.body ? JSON.parse(response.body) : response;
    return result;
  }

  private async callSearchLibraries(args: any): Promise<any> {
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(args || {})) {
      if (value !== undefined && value !== null) {
        searchParams.append(key, String(value));
      }
    }
    const response = await handleSearchLibraries(searchParams);
    const result = response.body ? JSON.parse(response.body) : response;
    return result;
  }

  private async callSearchLibrary(args: any): Promise<any> {
    // Apply mode-based defaults before creating search params
    const effectiveMode = args.mode || MCPSettingsService.get('content.mode');
    const modeConfig = this.getSearchModeConfiguration(effectiveMode);
    
    // Apply mode defaults if not explicitly provided
    const processedArgs = {
      ...args,
      limit: args.limit || modeConfig.limit
    };
    
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(processedArgs)) {
      if (value !== undefined && value !== null) {
        if (key !== 'mode') { // Don't pass mode to API
          searchParams.append(key, String(value));
        }
      }
    }
    
    const SEARCH_TIMEOUT_MS = 25000; // 25 秒超时，低于 keepAlive 的 30 秒
    const searchPromise = handleSearch(searchParams);
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("Search timed out after 25 seconds. Try narrowing your query or reducing the limit.")), SEARCH_TIMEOUT_MS);
    });
    const response = await Promise.race([searchPromise, timeoutPromise]);
    let result = response.body ? JSON.parse(response.body) : response;
    
    // Add mode information to metadata
    if (result && typeof result === 'object') {
      result.metadata = {
        ...result.metadata,
        mode: effectiveMode,
        appliedModeConfig: modeConfig
      };
      
      // Remove any unwanted content array if it's empty
      if (Array.isArray(result.content) && result.content.length === 0) {
        delete result.content;
      }
    }
    
    return result;
  }

  private async callSearchAnnotations(args: any): Promise<any> {
    const extractor = new SmartAnnotationExtractor();
    const { q, ...options } = args;
    const result = await extractor.searchAnnotations(q, options);
    return result;
  }

  private async callGetItemDetails(args: any): Promise<any> {
    const { itemKey, mode, libraryID } = args;
    
    // Import the specific handler for item details
    const { handleGetItem } = await import('./apiHandlers');
    
    // Get effective mode
    const effectiveMode = mode || MCPSettingsService.get('content.mode');
    
    // Create query params with mode-based field selection
    const queryParams = new URLSearchParams();
    if (libraryID !== undefined && libraryID !== null) {
      queryParams.append('libraryID', String(libraryID));
    }
    if (effectiveMode !== 'complete') {
      // Apply field filtering based on mode (this could be enhanced in apiHandlers)
      const modeConfig = this.getItemDetailsModeConfiguration(effectiveMode);
      if (modeConfig.fields) {
        queryParams.append('fields', modeConfig.fields.join(','));
      }
    }
    
    // Call the dedicated item details handler
    const response = await handleGetItem({ 1: itemKey }, queryParams);
    let result = response.body ? JSON.parse(response.body) : response;
    
    // Add mode information to metadata
    if (result && typeof result === 'object') {
      result.metadata = {
        ...result.metadata,
        mode: effectiveMode,
        appliedModeConfig: this.getItemDetailsModeConfiguration(effectiveMode)
      };
    }
    
    return result;
  }

  private async callGetAnnotations(args: any): Promise<any> {
    const extractor = new SmartAnnotationExtractor();
    const result = await extractor.getAnnotations(args);
    return result;
  }

  private async callGetContent(args: any): Promise<any> {
    const { itemKey, attachmentKey, include, format, mode, contentControl, libraryID } = args;
    const extractor = new UnifiedContentExtractor();
    
    try {
      let result;
      
      if (itemKey) {
        // Get content from item with unified mode control and content control parameters
        result = await extractor.getItemContent(itemKey, include || {}, mode, contentControl, libraryID);
      } else if (attachmentKey) {
        // Get content from specific attachment with unified mode control and content control parameters
        result = await extractor.getAttachmentContent(attachmentKey, mode, contentControl, libraryID);
      } else {
        throw new Error('Either itemKey or attachmentKey must be provided');
      }
      
      // Apply format conversion if requested
      if (format === 'text' && itemKey) {
        return extractor.convertToText(result);
      } else if (format === 'text' && attachmentKey) {
        return result.content || '';
      }
      
      return result;
    } catch (error) {
      ztoolkit.log(`[StreamableMCP] Error in callGetContent: ${error}`, 'error');
      throw error;
    }
  }

  private async callGetCollections(args: any): Promise<any> {
    // Apply mode-based defaults before creating search params
    const effectiveMode = args.mode || MCPSettingsService.get('content.mode');
    const modeConfig = this.getCollectionModeConfiguration(effectiveMode);
    
    // Apply mode defaults if not explicitly provided
    const processedArgs = {
      ...args,
      limit: args.limit || modeConfig.limit
    };
    
    const collectionParams = new URLSearchParams();
    for (const [key, value] of Object.entries(processedArgs)) {
      if (value !== undefined && value !== null) {
        if (key !== 'mode') { // Don't pass mode to API
          collectionParams.append(key, String(value));
        }
      }
    }
    
    const response = await handleGetCollections(collectionParams);
    let result = response.body ? JSON.parse(response.body) : response;
    
    // Add mode information to metadata
    if (result && typeof result === 'object') {
      result.metadata = {
        ...result.metadata,
        mode: effectiveMode,
        appliedModeConfig: modeConfig
      };
    }
    
    return result;
  }

  private async callSearchCollections(args: any): Promise<any> {
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(args || {})) {
      if (value !== undefined && value !== null) {
        searchParams.append(key, String(value));
      }
    }
    const response = await handleSearchCollections(searchParams);
    const result = response.body ? JSON.parse(response.body) : response;
    return result;
  }

  private async callGetCollectionDetails(args: any): Promise<any> {
    const { collectionKey, ...otherArgs } = args;
    const detailParams = new URLSearchParams();
    for (const [key, value] of Object.entries(otherArgs)) {
      if (value !== undefined && value !== null) {
        detailParams.append(key, String(value));
      }
    }
    const response = await handleGetCollectionDetails({ 1: collectionKey }, detailParams);
    const result = response.body ? JSON.parse(response.body) : response;
    return result;
  }

  private async callGetCollectionItems(args: any): Promise<any> {
    const { collectionKey, ...otherArgs } = args;
    const itemParams = new URLSearchParams();
    for (const [key, value] of Object.entries(otherArgs)) {
      if (value !== undefined && value !== null) {
        itemParams.append(key, String(value));
      }
    }
    const response = await handleGetCollectionItems({ 1: collectionKey }, itemParams);
    const result = response.body ? JSON.parse(response.body) : response;
    return result;
  }

  private async callGetSubcollections(args: any): Promise<any> {
    const { collectionKey, ...otherArgs } = args;
    const subcollectionParams = new URLSearchParams();
    for (const [key, value] of Object.entries(otherArgs)) {
      if (value !== undefined && value !== null) {
        subcollectionParams.append(key, String(value));
      }
    }
    const response = await handleGetSubcollections({ 1: collectionKey }, subcollectionParams);
    const result = response.body ? JSON.parse(response.body) : response;
    return result;
  }

  private async callCreateCollection(args: any): Promise<any> {
    const response = await handleCreateCollection({
      libraryID: args.libraryID,
      name: args.name,
      parentCollection: args.parentCollection,
    });
    return response.body ? JSON.parse(response.body) : response;
  }

  private async callUpdateCollection(args: any): Promise<any> {
    const { collectionKey, ...body } = args;
    const response = await handleUpdateCollection({ 1: collectionKey }, body);
    return response.body ? JSON.parse(response.body) : response;
  }

  private async callDeleteCollection(args: any): Promise<any> {
    const { collectionKey, ...body } = args;
    const response = await handleDeleteCollection({ 1: collectionKey }, body);
    return response.body ? JSON.parse(response.body) : response;
  }

  /**
   * Accept arrays that some MCP clients serialize as strings, e.g.
   * '["KEY1","KEY2"]' or 'KEY1,KEY2' (#71).
   */
  private coerceStringArray(value: unknown): string[] | undefined {
    if (Array.isArray(value)) {
      return value.map(String);
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.startsWith('[')) {
        try {
          const parsed = JSON.parse(trimmed);
          if (Array.isArray(parsed)) return parsed.map(String);
        } catch {
          // fall through to comma-split
        }
      }
      if (trimmed.length > 0) {
        return trimmed.split(',').map((s) => s.trim()).filter(Boolean);
      }
    }
    return undefined;
  }

  private async callAddItemsToCollection(args: any): Promise<any> {
    const { collectionKey, itemKeys, libraryID } = args;
    const response = await handleAddItemsToCollection({ 1: collectionKey }, { itemKeys, libraryID });
    return response.body ? JSON.parse(response.body) : response;
  }

  private async callRemoveItemsFromCollection(args: any): Promise<any> {
    const { collectionKey, itemKeys, libraryID } = args;
    const response = await handleRemoveItemsFromCollection({ 1: collectionKey }, { itemKeys, libraryID });
    return response.body ? JSON.parse(response.body) : response;
  }

  private async callSearchFulltext(args: any): Promise<any> {
    // Apply mode-based defaults before creating search params
    const effectiveMode = args.mode || MCPSettingsService.get('content.mode');
    const modeConfig = this.getFulltextModeConfiguration(effectiveMode);
    
    // Apply mode defaults if not explicitly provided
    const processedArgs = {
      ...args,
      contextLength: args.contextLength || modeConfig.contextLength,
      maxResults: args.maxResults || modeConfig.maxResults
    };
    
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(processedArgs)) {
      if (value !== undefined && value !== null) {
        if (key === 'itemKeys' && Array.isArray(value)) {
          searchParams.append(key, value.join(','));
        } else if (key !== 'mode') { // Don't pass mode to API
          searchParams.append(key, String(value));
        }
      }
    }
    
    const response = await handleSearchFulltext(searchParams);
    let result = response.body ? JSON.parse(response.body) : response;
    
    // Add mode information to metadata
    if (result && typeof result === 'object') {
      result.metadata = {
        ...result.metadata,
        mode: effectiveMode,
        appliedModeConfig: modeConfig
      };
    }
    
    return result;
  }

  private async callGetItemAbstract(args: any): Promise<any> {
    const { itemKey, ...otherArgs } = args;
    const abstractParams = new URLSearchParams();
    for (const [key, value] of Object.entries(otherArgs)) {
      if (value !== undefined && value !== null) {
        abstractParams.append(key, String(value));
      }
    }
    const response = await handleGetItemAbstract({ 1: itemKey }, abstractParams);
    const contentType = response.headers?.['Content-Type'] || '';
    if (contentType.startsWith('text/plain')) {
      // format=text returns a plain-text body that must not be JSON.parsed
      return response.body;
    }
    const result = response.body ? JSON.parse(response.body) : response;
    return result;
  }

  // ============ Semantic Search Methods ============

  private async callSemanticSearch(args: any): Promise<any> {
    const mode: 'hybrid' | 'semantic' = args.mode ?? 'hybrid';
    const query: string = args.query;
    const topK: number = args.topK ?? 10;

    if (mode === 'semantic') {
      // Pure-vector path — unchanged from original behaviour
      try {
        const semanticService = getSemanticSearchService();
        await semanticService.initialize();
        const results = await semanticService.search(query, {
          topK,
          minScore: args.minScore,
          language: args.language
        });
        return {
          mode: 'semantic',
          query,
          data: results,
          metadata: {
            extractedAt: new Date().toISOString(),
            searchMode: 'semantic',
            resultCount: results.length,
            fallbackMode: semanticService.getIndexProgress().status === 'idle'
              ? (await semanticService.getStats()).serviceStatus.fallbackMode
              : false
          }
        };
      } catch (error) {
        ztoolkit.log(`[StreamableMCP] Semantic search error: ${error}`, 'error');
        throw error;
      }
    }

    // Hybrid mode (default): RRF fusion of vector + keyword (ZotSeek pattern)
    const { wSem, wKey, reason } = analyzeQuery(query);

    // Semantic leg — best-effort, degrade gracefully if index empty/unavailable
    let semanticResults: SemanticSearchResult[] = [];
    let semanticUnavailable = false;
    try {
      const semanticService = getSemanticSearchService();
      await semanticService.initialize();
      semanticResults = await semanticService.search(query, {
        topK: topK * 2,
        minScore: args.minScore,
        language: args.language
      });
    } catch (error) {
      ztoolkit.log(`[StreamableMCP] Hybrid semantic leg unavailable (degrading to keyword-only): ${error}`, 'warn');
      semanticUnavailable = true;
    }

    // Keyword leg — direct call to searchEngine, no fallback wrapping needed
    let keywordItems: Array<{ itemKey: string; [k: string]: any }> = [];
    let keywordUnavailable = false;
    try {
      const kwResponse = await handleSearchRequest({ q: query, limit: String(topK * 2) });
      keywordItems = (kwResponse.results ?? []).map((r: any) => ({ ...r, itemKey: r.key ?? r.itemKey }));
    } catch (error) {
      ztoolkit.log(`[StreamableMCP] Hybrid keyword leg failed: ${error}`, 'warn');
      keywordUnavailable = true;
    }

    // Semantic unavailable → keyword-only fallback
    if (semanticUnavailable) {
      return {
        mode: 'hybrid',
        query,
        data: keywordItems.slice(0, topK).map((r: any) => ({
          itemKey: r.itemKey,
          title: r.title ?? '',
          creators: r.creators,
          year: r.year ?? r.date ?? null,
          itemType: r.itemType,
          score: 0,
          matchedChunks: [],
          inSemantic: false,
          inKeyword: true,
        })),
        metadata: {
          extractedAt: new Date().toISOString(),
          searchMode: 'hybrid',
          resultCount: Math.min(keywordItems.length, topK),
          weights: { wSem, wKey },
          reason: `semantic-index-unavailable, keyword-only fallback; ${reason}`,
        }
      };
    }

    // RRF fusion → take topK
    const fused = rrfFuse(semanticResults, keywordItems, wSem, wKey).slice(0, topK);

    const semByKey = new Map(semanticResults.map(r => [r.itemKey, r]));
    const kwByKey = new Map(keywordItems.map(r => [r.itemKey, r]));

    const data = fused.map(f => {
      if (f.inSemantic) {
        const s = semByKey.get(f.itemKey)!;
        return {
          itemKey: s.itemKey,
          title: s.title ?? '',
          creators: s.creators,
          year: s.year,
          itemType: s.itemType,
          score: f.score,
          matchedChunks: s.matchedChunks ?? [],
          inSemantic: f.inSemantic,
          inKeyword: f.inKeyword,
        };
      }
      const k = kwByKey.get(f.itemKey)!;
      return {
        itemKey: k.itemKey,
        title: k.title ?? '',
        creators: k.creators,
        year: k.year ?? k.date ?? null,
        itemType: k.itemType,
        score: f.score,
        matchedChunks: [],
        inSemantic: false,
        inKeyword: true,
      };
    });

    return {
      mode: 'hybrid',
      query,
      data,
      metadata: {
        extractedAt: new Date().toISOString(),
        searchMode: 'hybrid',
        resultCount: data.length,
        weights: { wSem, wKey },
        reason: keywordUnavailable ? `${reason}; keyword-search-unavailable, semantic-only` : reason,
      }
    };
  }

  private async callFindSimilar(args: any): Promise<any> {
    try {
      const semanticService = getSemanticSearchService();
      await semanticService.initialize();

      const results = await semanticService.findSimilar(args.itemKey, {
        topK: args.topK,
        minScore: args.minScore
      });

      const response = {
        mode: 'similar',
        sourceItemKey: args.itemKey,
        data: results,
        metadata: {
          extractedAt: new Date().toISOString(),
          resultCount: results.length
        }
      };

      return response;
    } catch (error) {
      ztoolkit.log(`[StreamableMCP] Find similar error: ${error}`, 'error');
      throw error;
    }
  }

  private async callSemanticStatus(): Promise<any> {
    try {
      const semanticService = getSemanticSearchService();
      const isReady = await semanticService.isReady();
      const stats = isReady ? await semanticService.getStats() : null;
      const progress = semanticService.getIndexProgress();

      // Check Int8 migration status
      let int8Status = null;
      try {
        const { getVectorStore } = await import('./semantic/vectorStore');
        const vectorStore = getVectorStore();
        await vectorStore.initialize();
        int8Status = await vectorStore.needsInt8Migration();
      } catch (e) {
        // Ignore if vector store not available
      }

      let message = !isReady
        ? 'Semantic search service not initialized'
        : stats?.serviceStatus.fallbackMode
          ? 'Running in fallback mode (API not configured)'
          : `Semantic search ready with ${stats?.indexStats.totalItems || 0} indexed items`;

      // Add Int8 migration suggestion if needed
      if (int8Status?.needed) {
        message += `. WARNING: ${int8Status.count}/${int8Status.total} vectors need Int8 migration for ~6x faster search. Run migrate_int8 to optimize.`;
      }

      return {
        ready: isReady,
        initialized: stats?.serviceStatus.initialized || false,
        fallbackMode: stats?.serviceStatus.fallbackMode || false,
        indexProgress: progress,
        indexStats: stats?.indexStats || null,
        int8Migration: int8Status,
        message
      };
    } catch (error) {
      ztoolkit.log(`[StreamableMCP] Semantic status error: ${error}`, 'error');
      return {
        ready: false,
        error: String(error)
      };
    }
  }

  private async callFulltextDatabase(args: any): Promise<any> {
    try {
      const { getVectorStore } = await import('./semantic/vectorStore');
      const vectorStore = getVectorStore();
      await vectorStore.initialize();

      const { action, query, itemKeys, limit = 20, caseSensitive = false } = args;

      switch (action) {
        case 'list': {
          const cachedItems = await vectorStore.listCachedContent();
          const limitedItems = cachedItems.slice(0, limit);

          return {
            action: 'list',
            data: limitedItems,
            metadata: {
              extractedAt: new Date().toISOString(),
              totalCached: cachedItems.length,
              returned: limitedItems.length,
              message: `Found ${cachedItems.length} items in full-text database`
            }
          };
        }

        case 'search': {
          if (!query) {
            throw new Error('query is required for search action');
          }

          const searchResults = await vectorStore.searchCachedContent(query, { limit, caseSensitive });

          return {
            action: 'search',
            query,
            data: searchResults,
            metadata: {
              extractedAt: new Date().toISOString(),
              resultCount: searchResults.length,
              caseSensitive,
              message: `Found ${searchResults.length} items matching "${query}"`
            }
          };
        }

        case 'get': {
          if (!itemKeys || itemKeys.length === 0) {
            throw new Error('itemKeys is required for get action');
          }

          const contentMap = await vectorStore.getFullContentBatch(itemKeys);
          const results: Array<{ itemKey: string; content: string | null; contentLength: number }> = [];

          for (const key of itemKeys) {
            const content = contentMap.get(key) || null;
            results.push({
              itemKey: key,
              content,
              contentLength: content ? content.length : 0
            });
          }

          return {
            action: 'get',
            data: results,
            metadata: {
              extractedAt: new Date().toISOString(),
              requested: itemKeys.length,
              found: results.filter(r => r.content !== null).length,
              message: `Retrieved content for ${results.filter(r => r.content !== null).length}/${itemKeys.length} items`
            }
          };
        }

        case 'stats': {
          const stats = await vectorStore.getStats();

          // Format size nicely
          const formatSize = (bytes: number) => {
            if (bytes < 1024) return `${bytes} B`;
            if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
            return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
          };

          return {
            action: 'stats',
            data: {
              cachedItems: stats.cachedContentItems,
              cachedContentSize: stats.cachedContentSizeBytes,
              cachedContentSizeFormatted: formatSize(stats.cachedContentSizeBytes),
              indexedItems: stats.totalItems,
              totalVectors: stats.totalVectors,
              zhVectors: stats.zhVectors,
              enVectors: stats.enVectors
            },
            metadata: {
              extractedAt: new Date().toISOString(),
              message: `Full-text database: ${stats.cachedContentItems} items, ${formatSize(stats.cachedContentSizeBytes)}`
            }
          };
        }

        default:
          throw new Error(`Unknown action: ${action}. Use list, search, get, or stats. Database management is done through Zotero preferences.`);
      }
    } catch (error) {
      ztoolkit.log(`[StreamableMCP] Fulltext database error: ${error}`, 'error');
      return {
        success: false,
        error: String(error)
      };
    }
  }

  /**
   * Convert Markdown content to HTML suitable for Zotero notes.
   * Auto-detects if content is already HTML and skips conversion.
   */
  private markdownToNoteHtml(markdown: string): string {
    if (!markdown || typeof markdown !== 'string') return '';

    // Detect if content is already HTML
    const trimmed = markdown.trim();
    if (trimmed.startsWith('<') && /<\/.+>/.test(trimmed)) {
      return markdown;
    }

    let html = markdown;

    // Escape HTML entities
    html = html.replace(/&/g, '&amp;')
               .replace(/</g, '&lt;')
               .replace(/>/g, '&gt;');

    // Headings (process longest first)
    html = html.replace(/^######\s+(.+)$/gm, '<h6>$1</h6>');
    html = html.replace(/^#####\s+(.+)$/gm, '<h5>$1</h5>');
    html = html.replace(/^####\s+(.+)$/gm, '<h4>$1</h4>');
    html = html.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>');

    // Bold + italic, bold, italic
    html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

    // Inline code
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Links
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

    // Horizontal rules
    html = html.replace(/^---+$/gm, '<hr/>');

    // Unordered lists (block)
    html = html.replace(/(?:^[-*+]\s+.+$\n?)+/gm, (match) => {
      const items = match.trim().split('\n').map((line: string) => {
        const content = line.replace(/^[-*+]\s+/, '');
        return `<li>${content}</li>`;
      }).join('');
      return `<ul>${items}</ul>\n`;
    });

    // Ordered lists (block)
    html = html.replace(/(?:^\d+\.\s+.+$\n?)+/gm, (match) => {
      const items = match.trim().split('\n').map((line: string) => {
        const content = line.replace(/^\d+\.\s+/, '');
        return `<li>${content}</li>`;
      }).join('');
      return `<ol>${items}</ol>\n`;
    });

    // Paragraphs: split by double newline, wrap plain text blocks in <p>
    const blocks = html.split(/\n\n+/);
    html = blocks.map((block: string) => {
      block = block.trim();
      if (!block) return '';
      if (/^<(h[1-6]|ul|ol|li|blockquote|hr|div|p|pre|table)/i.test(block)) {
        return block;
      }
      block = block.replace(/\n/g, '<br/>');
      return `<p>${block}</p>`;
    }).filter(Boolean).join('\n');

    return html;
  }

  /**
   * Handle write_note tool calls: create, update, append notes
   */
  private async callWriteNote(args: any): Promise<any> {
    const { action, parentKey, noteKey, content, tags, libraryID = Zotero.Libraries.userLibraryID } = args;

    try {
      const htmlContent = this.markdownToNoteHtml(content);

      switch (action) {
        case 'create': {
          const note = new Zotero.Item('note');
          note.libraryID = libraryID;

          if (parentKey) {
            const parentItem = await Zotero.Items.getByLibraryAndKeyAsync(
              libraryID, parentKey
            );
            if (!parentItem) {
              throw new Error(`Parent item not found in library ${libraryID}: ${parentKey}`);
            }
            if (parentItem.isNote()) {
              throw new Error('Cannot attach a note to another note');
            }
            if (parentItem.isAttachment()) {
              throw new Error('Cannot attach a note to an attachment');
            }
            note.parentKey = parentKey;
          }

          note.setNote(htmlContent);

          if (tags && Array.isArray(tags)) {
            for (const tag of tags) {
              note.addTag(tag, 0);
            }
          }

          await note.saveTx();

          ztoolkit.log(`[StreamableMCP] Created note ${note.key}${parentKey ? ' attached to ' + parentKey : ' (standalone)'}`);

          return {
            action: 'create',
            success: true,
            data: {
              noteKey: note.key,
              parentKey: parentKey || null,
              type: parentKey ? 'child' : 'standalone',
              contentPreview: content.substring(0, 200),
              contentLength: content.length,
              tags: tags || [],
              dateCreated: note.dateAdded
            },
            metadata: {
              extractedAt: new Date().toISOString(),
              message: `Note created successfully (key: ${note.key})`
            }
          };
        }

        case 'update': {
          if (!noteKey) {
            throw new Error('noteKey is required for update action');
          }

          const existingNote = await Zotero.Items.getByLibraryAndKeyAsync(
            libraryID, noteKey
          );
          if (!existingNote) {
            throw new Error(`Note not found in library ${libraryID}: ${noteKey}`);
          }
          if (!existingNote.isNote()) {
            throw new Error(`Item ${noteKey} is not a note`);
          }

          existingNote.setNote(htmlContent);

          if (tags && Array.isArray(tags)) {
            for (const tag of tags) {
              existingNote.addTag(tag, 0);
            }
          }

          await existingNote.saveTx();

          ztoolkit.log(`[StreamableMCP] Updated note ${noteKey}`);

          return {
            action: 'update',
            success: true,
            data: {
              noteKey,
              contentPreview: content.substring(0, 200),
              contentLength: content.length,
              tags: existingNote.getTags().map((t: any) => t.tag),
              dateModified: existingNote.dateModified
            },
            metadata: {
              extractedAt: new Date().toISOString(),
              message: `Note ${noteKey} updated successfully`
            }
          };
        }

        case 'append': {
          if (!noteKey) {
            throw new Error('noteKey is required for append action');
          }

          const existingNote = await Zotero.Items.getByLibraryAndKeyAsync(
            libraryID, noteKey
          );
          if (!existingNote) {
            throw new Error(`Note not found in library ${libraryID}: ${noteKey}`);
          }
          if (!existingNote.isNote()) {
            throw new Error(`Item ${noteKey} is not a note`);
          }

          const currentHtml = existingNote.getNote() || '';
          const appendedHtml = currentHtml + htmlContent;
          existingNote.setNote(appendedHtml);

          if (tags && Array.isArray(tags)) {
            for (const tag of tags) {
              existingNote.addTag(tag, 0);
            }
          }

          await existingNote.saveTx();

          ztoolkit.log(`[StreamableMCP] Appended to note ${noteKey}`);

          return {
            action: 'append',
            success: true,
            data: {
              noteKey,
              appendedContentPreview: content.substring(0, 200),
              appendedContentLength: content.length,
              totalContentLength: appendedHtml.length,
              tags: existingNote.getTags().map((t: any) => t.tag),
              dateModified: existingNote.dateModified
            },
            metadata: {
              extractedAt: new Date().toISOString(),
              message: `Content appended to note ${noteKey} successfully`
            }
          };
        }

        default:
          throw new Error(`Unknown action: ${action}. Use create, update, or append.`);
      }
    } catch (error) {
      ztoolkit.log(`[StreamableMCP] Write note error: ${error}`, 'error');
      return {
        success: false,
        error: String(error)
      };
    }
  }

  /**
   * Handle write_tag tool calls: add, remove, set tags on items
   */
  private async callWriteTag(args: any): Promise<any> {
    const { action, itemKey, tags, libraryID = Zotero.Libraries.userLibraryID } = args;

    try {
      const item = await Zotero.Items.getByLibraryAndKeyAsync(
        libraryID, itemKey
      );
      if (!item) {
        throw new Error(`Item not found in library ${libraryID}: ${itemKey}`);
      }

      const beforeTags = item.getTags().map((t: any) => t.tag);

      switch (action) {
        case 'add': {
          for (const tag of tags) {
            item.addTag(tag, 0);
          }
          break;
        }

        case 'remove': {
          for (const tag of tags) {
            item.removeTag(tag);
          }
          break;
        }

        case 'set': {
          // Remove all existing tags
          for (const existing of beforeTags) {
            item.removeTag(existing);
          }
          // Add new tags
          for (const tag of tags) {
            item.addTag(tag, 0);
          }
          break;
        }

        default:
          throw new Error(`Unknown action: ${action}. Use add, remove, or set.`);
      }

      await item.saveTx();

      const afterTags = item.getTags().map((t: any) => t.tag);

      ztoolkit.log(`[StreamableMCP] write_tag ${action} on ${itemKey}: [${beforeTags.join(', ')}] -> [${afterTags.join(', ')}]`);

      return {
        action,
        success: true,
        data: {
          itemKey,
          beforeTags,
          afterTags,
          tagsModified: tags
        },
        metadata: {
          extractedAt: new Date().toISOString(),
          message: `Tags ${action === 'add' ? 'added to' : action === 'remove' ? 'removed from' : 'set on'} item ${itemKey}`
        }
      };
    } catch (error) {
      ztoolkit.log(`[StreamableMCP] Write tag error: ${error}`, 'error');
      return {
        success: false,
        error: String(error)
      };
    }
  }

  /**
   * Handle write_metadata tool calls: update fields and creators on items
   */
  private async callWriteMetadata(args: any): Promise<any> {
    const { itemKey, fields, creators, libraryID = Zotero.Libraries.userLibraryID } = args;

    try {
      const item = await Zotero.Items.getByLibraryAndKeyAsync(
        libraryID, itemKey
      );
      if (!item) {
        throw new Error(`Item not found in library ${libraryID}: ${itemKey}`);
      }
      if (!item.isRegularItem()) {
        throw new Error(`Item ${itemKey} is not a regular item (it is a ${item.itemType}). Use write_note for notes.`);
      }

      const updatedFields: Record<string, { before: string; after: string }> = {};
      let creatorsUpdated = false;
      let beforeCreators: any[] = [];
      let afterCreators: any[] = [];

      // Update fields
      if (fields && typeof fields === 'object') {
        for (const [fieldName, value] of Object.entries(fields)) {
          try {
            const before = String(item.getField(fieldName) || '');
            item.setField(fieldName, String(value));
            updatedFields[fieldName] = { before, after: String(value) };
          } catch (fieldError) {
            throw new Error(`Failed to set field "${fieldName}": ${fieldError}`);
          }
        }
      }

      // Update creators
      if (creators && Array.isArray(creators)) {
        beforeCreators = item.getCreators().map((c: any) => ({
          creatorType: Zotero.CreatorTypes.getName(c.creatorTypeID),
          firstName: c.firstName,
          lastName: c.lastName
        }));

        item.setCreators(creators.map((c: any) => {
          const creatorData: any = {
            creatorType: c.creatorType || 'author'
          };
          if (c.name) {
            // Organization / single-field name
            creatorData.name = c.name;
          } else {
            creatorData.firstName = c.firstName || '';
            creatorData.lastName = c.lastName || '';
          }
          return creatorData;
        }));

        creatorsUpdated = true;
        afterCreators = creators;
      }

      await item.saveTx();

      ztoolkit.log(`[StreamableMCP] Updated metadata on ${itemKey}: fields=[${Object.keys(updatedFields).join(', ')}], creators=${creatorsUpdated}`);

      return {
        success: true,
        data: {
          itemKey,
          updatedFields,
          creatorsUpdated,
          ...(creatorsUpdated ? { beforeCreators, afterCreators } : {})
        },
        metadata: {
          extractedAt: new Date().toISOString(),
          message: `Metadata updated on item ${itemKey}`
        }
      };
    } catch (error) {
      ztoolkit.log(`[StreamableMCP] Write metadata error: ${error}`, 'error');
      return {
        success: false,
        error: String(error)
      };
    }
  }

  /**
   * Handle write_item tool calls: create items, reparent attachments, and import files
   */
  private async callWriteItem(args: any): Promise<any> {
    const { action, itemType, fields, creators, tags, attachmentKeys, parentKey, filePath, parentItemKey, title, libraryID = Zotero.Libraries.userLibraryID } = args;

    try {
      switch (action) {
        case 'create': {
          if (!itemType) {
            throw new Error('itemType is required for create action (e.g., journalArticle, book, conferencePaper)');
          }

          // Create new item
          const item = new Zotero.Item(itemType);
          item.libraryID = libraryID;

          // Set fields
          if (fields && typeof fields === 'object') {
            for (const [fieldName, value] of Object.entries(fields)) {
              try {
                item.setField(fieldName, String(value));
              } catch (fieldError) {
                throw new Error(`Failed to set field "${fieldName}": ${fieldError}`);
              }
            }
          }

          // Set creators
          if (creators && Array.isArray(creators)) {
            item.setCreators(creators.map((c: any) => {
              const creatorData: any = { creatorType: c.creatorType || 'author' };
              if (c.name) {
                creatorData.name = c.name;
              } else {
                creatorData.firstName = c.firstName || '';
                creatorData.lastName = c.lastName || '';
              }
              return creatorData;
            }));
          }

          // Add tags
          if (tags && Array.isArray(tags)) {
            for (const tag of tags) {
              item.addTag(tag, 0);
            }
          }

          await item.saveTx();

          ztoolkit.log(`[StreamableMCP] Created item ${item.key} (type: ${itemType})`);

          // Re-parent attachments if provided
          const reparentedAttachments: string[] = [];
          if (attachmentKeys && Array.isArray(attachmentKeys)) {
            for (const attKey of attachmentKeys) {
              const attachment = await Zotero.Items.getByLibraryAndKeyAsync(
                libraryID, attKey
              );
              if (!attachment) {
                ztoolkit.log(`[StreamableMCP] Attachment not found in library ${libraryID}: ${attKey}`, 'warn');
                continue;
              }
              if (!attachment.isAttachment()) {
                ztoolkit.log(`[StreamableMCP] Item ${attKey} is not an attachment (type: ${attachment.itemType}), skipping`, 'warn');
                continue;
              }
              attachment.parentKey = item.key;
              await attachment.saveTx();
              reparentedAttachments.push(attKey);
              ztoolkit.log(`[StreamableMCP] Re-parented attachment ${attKey} under ${item.key}`);
            }
          }

          return {
            action: 'create',
            success: true,
            data: {
              itemKey: item.key,
              itemType,
              title: fields?.title || '',
              creatorsCount: creators?.length || 0,
              tagsCount: tags?.length || 0,
              reparentedAttachments,
              dateCreated: item.dateAdded
            },
            metadata: {
              extractedAt: new Date().toISOString(),
              message: `Item created (key: ${item.key}, type: ${itemType})${reparentedAttachments.length > 0 ? `, ${reparentedAttachments.length} attachment(s) attached` : ''}`
            }
          };
        }

        case 'reparent': {
          if (!attachmentKeys || !Array.isArray(attachmentKeys) || attachmentKeys.length === 0) {
            throw new Error('attachmentKeys is required for reparent action');
          }
          if (!parentKey) {
            throw new Error('parentKey is required for reparent action');
          }

          // Verify parent exists
          const parentItem = await Zotero.Items.getByLibraryAndKeyAsync(
            libraryID, parentKey
          );
          if (!parentItem) {
            throw new Error(`Parent item not found in library ${libraryID}: ${parentKey}`);
          }
          if (!parentItem.isRegularItem()) {
            throw new Error(`Parent ${parentKey} is not a regular item (type: ${parentItem.itemType})`);
          }

          const results: Array<{ key: string; success: boolean; error?: string }> = [];
          for (const attKey of attachmentKeys) {
            try {
              const attachment = await Zotero.Items.getByLibraryAndKeyAsync(
                libraryID, attKey
              );
              if (!attachment) {
                results.push({ key: attKey, success: false, error: `Not found in library ${libraryID}` });
                continue;
              }
              if (!attachment.isAttachment() && !attachment.isNote()) {
                results.push({ key: attKey, success: false, error: `Not an attachment or note (type: ${attachment.itemType})` });
                continue;
              }
              attachment.parentKey = parentKey;
              await attachment.saveTx();
              results.push({ key: attKey, success: true });
              ztoolkit.log(`[StreamableMCP] Re-parented ${attKey} under ${parentKey}`);
            } catch (attError) {
              results.push({ key: attKey, success: false, error: String(attError) });
            }
          }

          const successCount = results.filter(r => r.success).length;

          return {
            action: 'reparent',
            success: successCount > 0,
            data: {
              parentKey,
              results,
              successCount,
              totalCount: attachmentKeys.length
            },
            metadata: {
              extractedAt: new Date().toISOString(),
              message: `Re-parented ${successCount}/${attachmentKeys.length} item(s) under ${parentKey}`
            }
          };
        }

        case 'import': {
          if (!filePath || typeof filePath !== 'string') {
            throw new Error('filePath is required for import action (absolute path to the file)');
          }
          const importParentKey = parentItemKey || parentKey;
          if (!importParentKey) {
            throw new Error('parentItemKey is required for import action');
          }
          if (!(await IOUtils.exists(filePath))) {
            throw new Error(`File not found: ${filePath}`);
          }

          // Verify parent exists
          const parentItem = await Zotero.Items.getByLibraryAndKeyAsync(
            libraryID, importParentKey
          );
          if (!parentItem) {
            throw new Error(`Parent item not found in library ${libraryID}: ${importParentKey}`);
          }
          if (!parentItem.isRegularItem()) {
            throw new Error(`Parent ${importParentKey} is not a regular item (type: ${parentItem.itemType}), cannot attach files`);
          }

          // Import file as attachment
          const attachment = await Zotero.Attachments.importFromFile({
            file: filePath,
            parentItemID: parentItem.id,
            title: title || filePath.split(/[\\/]/).pop() || 'Imported Attachment'
          });

          ztoolkit.log(`[StreamableMCP] Imported file as attachment ${attachment.key} under ${importParentKey}`);

          return {
            action: 'import',
            success: true,
            data: {
              attachmentKey: attachment.key,
              parentItemKey: importParentKey,
              filePath,
              title: attachment.getField('title')
            },
            metadata: {
              extractedAt: new Date().toISOString(),
              message: `File imported as attachment (key: ${attachment.key}) under parent ${importParentKey}`
            }
          };
        }

        default:
          throw new Error(`Unknown action: ${action}. Use create, reparent, or import.`);
      }
    } catch (error) {
      ztoolkit.log(`[StreamableMCP] Write item error: ${error}`, 'error');
      return {
        success: false,
        error: String(error)
      };
    }
  }

  /**
   * Format tool result for MCP response with intelligent content type detection
   */
  private formatToolResult(result: any, toolName: string, args: any): any {
    // Check if client explicitly requested text format
    const requestedTextFormat = args?.format === 'text';
    
    // If result is already a string (text format), wrap it in MCP content format
    if (typeof result === 'string') {
      return {
        content: [
          {
            type: 'text',
            text: result,
          },
        ],
        isError: false,
      };
    }
    
    // For structured data, provide both JSON and formatted options
    if (typeof result === 'object' && result !== null) {
      // If explicitly requested text format, convert to readable text
      if (requestedTextFormat) {
        return {
          content: [
            {
              type: 'text',
              text: this.formatObjectAsText(result, toolName),
            },
          ],
          isError: false,
        };
      }
      
      // Default: provide structured JSON with formatted preview
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
        isError: false,
        // Include raw structured data for programmatic access
        _structuredData: result,
        _contentType: 'application/json'
      };
    }
    
    // Fallback for other types
    return {
      content: [
        {
          type: 'text',
          text: String(result),
        },
      ],
      isError: false,
    };
  }

  /**
   * Format object as human-readable text based on tool type
   */
  private formatObjectAsText(obj: any, toolName: string): string {
    switch (toolName) {
      case 'get_content':
        return this.formatContentAsText(obj);
      case 'search_library':
        return this.formatSearchResultsAsText(obj);
      case 'get_annotations':
        return this.formatAnnotationsAsText(obj);
      default:
        return JSON.stringify(obj, null, 2);
    }
  }

  private formatContentAsText(contentResult: any): string {
    const parts = [];
    
    if (contentResult.title) {
      parts.push(`TITLE: ${contentResult.title}\n`);
    }
    
    if (contentResult.content) {
      if (contentResult.content.abstract) {
        parts.push(`ABSTRACT:\n${contentResult.content.abstract.content}\n`);
      }
      
      if (contentResult.content.attachments) {
        for (const att of contentResult.content.attachments) {
          parts.push(`ATTACHMENT (${att.filename || att.type}):\n${att.content}\n`);
        }
      }
      
      if (contentResult.content.notes) {
        for (const note of contentResult.content.notes) {
          parts.push(`NOTE (${note.title}):\n${note.content}\n`);
        }
      }
    }
    
    return parts.join('\n---\n\n');
  }

  private formatSearchResultsAsText(searchResult: any): string {
    if (!searchResult.results || !Array.isArray(searchResult.results)) {
      return JSON.stringify(searchResult, null, 2);
    }
    
    const parts = [`SEARCH RESULTS (${searchResult.results.length} items):\n`];
    
    searchResult.results.forEach((item: any, index: number) => {
      parts.push(`${index + 1}. ${item.title || 'Untitled'}`);
      if (item.creators && item.creators.length > 0) {
        parts.push(`   Authors: ${item.creators.map((c: any) => c.name || `${c.firstName} ${c.lastName}`).join(', ')}`);
      }
      if (item.date) {
        parts.push(`   Date: ${item.date}`);
      }
      if (item.itemKey) {
        parts.push(`   Key: ${item.itemKey}`);
      }
      parts.push('');
    });
    
    return parts.join('\n');
  }

  private formatAnnotationsAsText(annotationResult: any): string {
    if (!annotationResult.data || !Array.isArray(annotationResult.data)) {
      return JSON.stringify(annotationResult, null, 2);
    }
    
    const parts = [`ANNOTATIONS (${annotationResult.data.length} items):\n`];
    
    annotationResult.data.forEach((ann: any, index: number) => {
      parts.push(`${index + 1}. [${ann.type.toUpperCase()}] ${ann.content}`);
      if (ann.page) {
        parts.push(`   Page: ${ann.page}`);
      }
      if (ann.dateModified) {
        parts.push(`   Modified: ${ann.dateModified}`);
      }
      parts.push('');
    });
    
    return parts.join('\n');
  }

  private createResponse(id: string | number | null, result: any): MCPResponse {
    return {
      jsonrpc: '2.0',
      id,
      result,
    };
  }

  private createError(id: string | number | null, code: number, message: string, data?: any): MCPResponse {
    return {
      jsonrpc: '2.0',
      id,
      error: { code, message, data },
    };
  }

  private isNotificationRequest(request: MCPRequest): boolean {
    return !Object.prototype.hasOwnProperty.call(request, 'id') || request.id === null || request.id === undefined;
  }

  /**
   * Get server status and capabilities
   */
  getStatus() {
    return {
      isInitialized: this.isInitialized,
      serverInfo: this.serverInfo,
      protocolVersion: LATEST_PROTOCOL_VERSION,
      supportedMethods: [
        'initialize',
        'initialized', 
        'notifications/initialized',
        'tools/list',
        'tools/call',
        'resources/list',
        'prompts/list',
        'ping'
      ],
      availableTools: [
        'get_libraries',
        'search_libraries',
        'search_library',
        'search_annotations',
        'get_item_details',
        'get_annotations',
        'get_content',
        'get_collections',
        'search_collections',
        'get_collection_details',
        'get_collection_items',
        'search_fulltext',
        'get_item_abstract',
        // Semantic Search Tools (read-only)
        'semantic_search',
        'find_similar',
        'semantic_status',
        // Full-text Database Tool (read-only)
        'fulltext_database',
        // Write Tools
        'write_note',
        'write_tag',
        'write_metadata',
        'write_item',
        'run_javascript'
      ],
      transport: {
        type: "streamable-http",
        keepAliveSupported: false,
        maxConnections: 100
      }
    };
  }

  /**
   * Get fulltext search mode configuration
   */
  private getFulltextModeConfiguration(mode: string): any {
    const modeConfigs = {
      'minimal': {
        contextLength: 100,
        maxResults: 20
      },
      'preview': {
        contextLength: 200,
        maxResults: 50  
      },
      'standard': {
        contextLength: 250,
        maxResults: 100
      },
      'complete': {
        contextLength: 400,
        maxResults: 200
      }
    };

    return modeConfigs[mode as keyof typeof modeConfigs] || modeConfigs['standard'];
  }

  /**
   * Get search mode configuration
   */
  private getSearchModeConfiguration(mode: string): any {
    const modeConfigs = {
      'minimal': {
        limit: 30
      },
      'preview': {
        limit: 100
      },
      'standard': {
        limit: 200
      },
      'complete': {
        limit: 500
      }
    };

    return modeConfigs[mode as keyof typeof modeConfigs] || modeConfigs['standard'];
  }

  /**
   * Get collection mode configuration
   */
  private getCollectionModeConfiguration(mode: string): any {
    const modeConfigs = {
      'minimal': {
        limit: 20
      },
      'preview': {
        limit: 50
      },
      'standard': {
        limit: 100
      },
      'complete': {
        limit: 500
      }
    };

    return modeConfigs[mode as keyof typeof modeConfigs] || modeConfigs['standard'];
  }

  /**
   * Get item details mode configuration
   */
  private getItemDetailsModeConfiguration(mode: string): any {
    const modeConfigs = {
      'minimal': {
        fields: ['key', 'title', 'creators', 'date', 'itemType']
      },
      'preview': {
        fields: ['key', 'title', 'creators', 'date', 'itemType', 'abstractNote', 'tags', 'collections']
      },
      'standard': {
        fields: null // Include most fields (default behavior)
      },
      'complete': {
        fields: null // Include all fields
      }
    };

    return modeConfigs[mode as keyof typeof modeConfigs] || modeConfigs['standard'];
  }
}

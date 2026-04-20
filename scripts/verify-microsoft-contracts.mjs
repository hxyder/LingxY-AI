import assert from "node:assert/strict";
import { createConnectorCatalog } from "../src/service/connectors/core/catalog.mjs";
import { validateConnectorObject } from "../src/service/connectors/core/validators.mjs";

const catalog = createConnectorCatalog();
const providers = catalog.listProviders();

const microsoft = providers.find((provider) => provider.provider === "microsoft");
assert.ok(microsoft, "microsoft provider must be present in the catalog");
assert.ok(microsoft.services.includes("microsoft.outlook"), "outlook service must be listed");
assert.ok(microsoft.services.includes("microsoft.calendar"), "calendar service must be listed");
assert.ok(microsoft.services.includes("microsoft.onedrive"), "onedrive service must be listed");

const outlookTools = catalog.listTools({ provider: "microsoft", service: "microsoft.outlook" });
const outlookToolIds = outlookTools.map((tool) => tool.id).sort();
assert.deepEqual(outlookToolIds, [
  "microsoft.outlook.create_draft_preview",
  "microsoft.outlook.list_emails",
  "microsoft.outlook.send_email"
]);

const calendarTools = catalog.listTools({ provider: "microsoft", service: "microsoft.calendar" });
assert.ok(calendarTools.some((tool) => tool.id === "microsoft.calendar.create_event"));

const onedriveTools = catalog.listTools({ provider: "microsoft", service: "microsoft.onedrive" });
assert.ok(onedriveTools.some((tool) => tool.id === "microsoft.onedrive.upload_file"));

const draftWorkflow = catalog.getWorkflow("microsoft.outlook.draft_confirm_send");
assert.ok(draftWorkflow, "Outlook draft confirm send workflow must exist");
assert.equal(draftWorkflow.risk, "high");
assert.ok(draftWorkflow.triggerPatterns.some((pattern) => pattern.includes("Outlook")));

const calendarWorkflow = catalog.getWorkflow("microsoft.calendar.create_confirm");
assert.ok(calendarWorkflow, "Outlook calendar create confirm workflow must exist");

// Empty subject/body must fail the draft preview validation.
const createDraftPreview = catalog.getTool("microsoft.outlook.create_draft_preview");
const emptyValidation = validateConnectorObject(
  { draft_preview: "", subject: "", body: "", pending_confirmation: true },
  createDraftPreview.outputValidators
);
assert.equal(emptyValidation.ok, false, "empty subject/body must fail validation");

// Populated preview validates.
const okValidation = validateConnectorObject(
  {
    draft_preview: "To: ada@example.com\nSubject: hello\n\nworld",
    subject: "hello",
    body: "world",
    pending_confirmation: true
  },
  createDraftPreview.outputValidators
);
assert.equal(okValidation.ok, true, "non-empty preview must validate");

console.log("Microsoft connector contracts verification passed.");

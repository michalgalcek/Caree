# Tool annotations – justification for the OpenAI review form

Generated from the code (`npm run annotations`). Every tool sets all three hints explicitly.

| Tool | Title | readOnly | destructive | openWorld | Justification |
|---|---|---|---|---|---|
| `list_operations` | List repair operations | true | false | false | Reads the static catalogue only. |
| `country_rules` | Country rules | true | false | false | Reads built-in configuration only. |
| `decode_vin` | Decode VIN | true | false | false | Pure computation on the given VIN; no data stored, no external call. |
| `find_vehicle` | Find vehicle | true | false | false | Search within the signed-in shop only. |
| `get_vehicle` | Vehicle card | true | false | false | Reads data of the signed-in shop. |
| `add_vehicle` | Add vehicle and customer | false | false | false | Creates a record in the shop; nothing is deleted or sent. |
| `upcoming_services` | Upcoming services | true | false | false | Reads data of the signed-in shop. |
| `estimate_job` | Estimate job | true | false | false | Calculation only; nothing is stored. |
| `find_free_slots` | Find free slots | true | false | false | Reads the schedule; does not reserve anything. |
| `book_appointment` | Book appointment | false | false | false | Creates a booking inside the shop; reversible with reschedule/cancel; nothing is sent to anyone. |
| `reschedule_appointment` | Reschedule appointment | false | false | false | Changes the time of a booking; can be changed back; nothing is deleted or sent. |
| `cancel_appointment` | Cancel appointment | false | true | false | Cancellation frees the slot and cannot be undone automatically. |
| `job_status` | Job status | true | false | false | Reads data of the signed-in shop. |
| `record_inspection` | Record inspection findings | false | false | false | Adds findings to a job; nothing is sent to the customer. |
| `create_approval_link` | Create approval link | false | false | false | Creates a private link; nothing is sent automatically. |
| `compare_parts` | Compare parts prices | true | false | true | Read-only price requests to external supplier systems chosen by the shop (therefore openWorld). |
| `order_parts` | Order parts | false | true | true | Sends an order to an external supplier – an irreversible commercial action. |
| `plan_workshop` | Workshop plan | true | false | false | Reads the schedule. |
| `booking_requests` | New booking requests | true | false | false | Reads data of the signed-in shop. |
| `get_shop_settings` | Shop settings | true | false | false | Reads configuration. |
| `set_shop_settings` | Change shop settings | false | false | false | Updates configuration of the signed-in shop; old values can be set back. |
| `setup_workshop` | Add lifts, mechanics, suppliers | false | false | false | Adds configuration records; nothing is deleted. |
| `export_customer_data` | Export customer data | true | false | false | Reads data; the export is shown only to the signed-in shop user. |
| `erase_customer_data` | Erase customer personal data | false | true | false | Irreversibly removes personal data. |

# Shop registration repair

The configured database was inspected on 2026-10-21. `Shop` lacked
`alternateMobile`, `email`, and `paymentTerms`. The additive migration was
successfully applied to that database (three columns added).

The backend also omitted the required `Shop.updatedAt` value and supplied seven
values for six `AuditLog` columns. The route now fixes both and saves the shop,
audit entry, and notifications in one transaction. Failure rolls everything back;
the realtime event is emitted only after commit. Notification values are bound
parameters, including names containing apostrophes.

## Deploy

1. Upload the updated `src/modules/shops/shop.routes.js` to the backend application
   directory on Hostinger, or deploy this backend revision through the existing
   deployment process.
2. For other databases, deploy `scripts/migrate-shop-registration.js` and run
   `npm run migrate:shops` from the backend directory using its normal database
   environment. This command is rerunnable and only adds missing nullable columns.
   Do not run `mysql -u USER -p DATABASE ...` unless the MySQL CLI is installed
   and those placeholders have been replaced with real credentials; the Node
   migration above uses the backend's configured database connection and does
   not require the `mysql` command.
3. Restart the Node application using the hosting control panel or its existing
   process manager.
4. Register a shop through the sales UI and confirm HTTP 201, the returned shop in
   the list, and a duplicate warning on a repeated registration.

Validation: all 49 backend tests passed, including registration success, duplicate
rejection, and rollback after an audit failure. The live backend code has not yet
been deployed or tested through an authenticated browser session.

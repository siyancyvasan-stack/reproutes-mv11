export const Role = {
    ADMIN: 'ADMIN',
    MANAGER: 'MANAGER',
    AGENT: 'AGENT',
    FACTORY_MANAGER: 'FACTORY_MANAGER'
};

export const FuelType = {
    PETROL: 'PETROL',
    DIESEL: 'DIESEL'
};

export const FuelAnomalyStatus = {
    NORMAL: 'NORMAL',
    HIGH_VARIANCE: 'HIGH_VARIANCE',
    DUPLICATE_SUSPECTED: 'DUPLICATE_SUSPECTED',
    GPS_MISMATCH: 'GPS_MISMATCH',
    REVIEW_REQUIRED: 'REVIEW_REQUIRED',
    BUDGET_EXCEEDED: 'BUDGET_EXCEEDED'
};

export const FuelClaimStatus = {
    DRAFT: 'DRAFT',
    SUBMITTED: 'SUBMITTED',
    VERIFIED: 'VERIFIED',
    FLAGGED: 'FLAGGED',
    APPROVED: 'APPROVED',
    REIMBURSED: 'REIMBURSED',
    REJECTED: 'REJECTED'
};

export const FuelGpsStatus = {
    GPS_MATCH: 'GPS_MATCH',
    GPS_NEARBY: 'GPS_NEARBY',
    GPS_MISMATCH: 'GPS_MISMATCH',
    GPS_UNAVAILABLE: 'GPS_UNAVAILABLE'
};

export const FuelQrStatus = {
    UNVERIFIED: 'UNVERIFIED',
    VERIFIED: 'VERIFIED',
    DUPLICATE: 'DUPLICATE'
};

export const InvoiceStatus = {
    PENDING: 'PENDING',
    PARTIAL: 'PARTIAL',
    PAID: 'PAID',
    OVERDUE: 'OVERDUE'
};

export const OrderStatus = {
    PENDING: 'PENDING',
    CONFIRMED: 'CONFIRMED',
    PROCESSING: 'PROCESSING',
    DISPATCHED: 'DISPATCHED',
    DELIVERED: 'DELIVERED',
    CANCELLED: 'CANCELLED'
};

export const RetailerDocumentStatus = {
    PENDING: 'PENDING',
    VERIFIED: 'VERIFIED',
    REJECTED: 'REJECTED',
    NOT_PROVIDED: 'NOT_PROVIDED'
};

export const RetailerDocumentType = {
    BR: 'BR',
    NIC: 'NIC',
    BILL: 'BILL',
    OTHER: 'OTHER'
};

export const RetailerStatus = {
    ACTIVE: 'ACTIVE',
    PENDING: 'PENDING',
    DRAFT: 'DRAFT',
    SUBMITTED: 'SUBMITTED',
    UNDER_REVIEW: 'UNDER_REVIEW',
    APPROVED: 'APPROVED',
    REJECTED: 'REJECTED',
    SUSPENDED: 'SUSPENDED',
    INACTIVE: 'INACTIVE'
};

export const ShopImageType = {
    STOREFRONT: 'STOREFRONT',
    INTERIOR: 'INTERIOR',
    OWNER: 'OWNER',
    DOCUMENT: 'DOCUMENT',
    OTHER: 'OTHER'
};

export const RoutePlanStatus = {
    DRAFT: 'DRAFT',
    ACTIVE: 'ACTIVE',
    COMPLETED: 'COMPLETED'
};

export const DispatchStatus = {
    PENDING: 'PENDING',
    IN_TRANSIT: 'IN_TRANSIT',
    DELIVERED: 'DELIVERED',
    CANCELLED: 'CANCELLED'
};

export const FactoryMemberStatus = {
    ACTIVE: 'ACTIVE',
    INACTIVE: 'INACTIVE',
    ON_LEAVE: 'ON_LEAVE'
};

export const ProductionStatus = {
    PLANNED: 'PLANNED',
    IN_PROGRESS: 'IN_PROGRESS',
    COMPLETED: 'COMPLETED',
    CANCELLED: 'CANCELLED'
};

export const StockMovementType = {
    IN: 'IN',
    OUT: 'OUT',
    ADJUSTMENT: 'ADJUSTMENT'
};

export const ContactAssignmentType = {
    PRIMARY: 'PRIMARY',
    SECONDARY: 'SECONDARY'
};

export const UserStatus = {
    ACTIVE: 'ACTIVE',
    INACTIVE: 'INACTIVE',
    SUSPENDED: 'SUSPENDED'
};

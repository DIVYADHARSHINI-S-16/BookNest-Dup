export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export const REQUEST_STATUS_BADGE: Record<string, string> = {
  PENDING: "badge badge-warning",
  SUPPLIER_FOUND: "badge badge-success",
  FULFILLED: "badge badge-success",
  UNAVAILABLE: "badge badge-danger",
  CANCELLED: "badge badge-danger",
};

export const REQUEST_STATUS_LABEL: Record<string, string> = {
  PENDING: "Pending",
  SUPPLIER_FOUND: "Supplier found",
  FULFILLED: "Fulfilled",
  UNAVAILABLE: "Unavailable",
  CANCELLED: "Cancelled",
};

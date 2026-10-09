-- Rules for the business location added in 0033. Applied in the same migrate run.

alter table "tenants" add constraint tenants_location_complete
  check ((location_latitude is null) = (location_longitude is null));
alter table "tenants" add constraint tenants_location_valid
  check (
    (location_latitude is null or location_latitude between -90 and 90)
    and (location_longitude is null or location_longitude between -180 and 180)
  );
alter table "tenants" add constraint tenants_clock_radius_sane
  check (clock_radius_metres between 5 and 1000);

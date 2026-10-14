-- app.touch_concern (0051) is a trigger function, so it cannot be called directly; revoke the
-- default execute grant anyway, as for every other internal function here.
revoke all on function app.touch_concern() from public;

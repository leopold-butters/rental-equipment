/* Storage boundary. Replace this factory with a compatible repository adapter.
   All views and business rules use the same database object and never access storage directly. */
window.createRentalRepository = function () {
  return new Rental.LocalRepository(window.localStorage);
};

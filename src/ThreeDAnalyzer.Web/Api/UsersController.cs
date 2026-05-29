using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using ThreeDAnalyzer.Web.Data;

namespace ThreeDAnalyzer.Web.Api;

[ApiController]
[Route("api/users")]
public class UsersController(AppDbContext db) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<List<UserDto>>> List()
    {
        var items = await db.Users.OrderBy(u => u.Username).ToListAsync();
        return items.Select(u => u.ToDto()).ToList();
    }
}
